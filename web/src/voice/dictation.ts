// Composer dictation: hold the mic to talk (or tap to start, tap again to stop). Uses the browser's free speech
// recognition, so nothing is uploaded to a OpenKrishBot server and no key is needed.
import { useCallback, useEffect, useRef, useState } from 'react';
import { SpeechRec, UNSUPPORTED, micErrorMessage, recLang } from './speech';
import { useVoiceRecorder } from '../nod/hooks/use-voice-recorder';

export type DictationState = 'idle' | 'recording' | 'transcribing';

const HOLD_MS = 350;

export function useDictation(onText: (text: string) => void, onError: (msg: string) => void, language?: string) {
  const [state, setState] = useState<DictationState>('idle');
  const rec = useRef<{ r: any; text: string; downAt: number; cancelled: boolean } | null>(null);
  const toggleMode = useRef(false);
  // Offline input: nod's recorder + the local transcriber on this computer (/api/speech), used once its model is downloaded.
  const recorder = useVoiceRecorder('dictation');
  const offline = useRef(false);
  const recorderApi = useRef(recorder);
  recorderApi.current = recorder;
  useEffect(() => { fetch('/api/speech', { credentials: 'include' }).then((r) => r.json()).then((j) => { offline.current = j.localInput?.state === 'ready'; }).catch(() => {}); }, []);
  useEffect(() => { if (recorder.error) cb.current.onError(recorder.error); }, [recorder.error]);
  const cb = useRef({ onText, onError, language });
  cb.current = { onText, onError, language };

  const finish = useCallback((cancel = false) => {
    const cur = rec.current;
    if (!cur) return;
    cur.cancelled = cancel;
    try { cur.r.stop(); } catch { /* already stopped */ }
  }, []);

  const beginOffline = useCallback(() => {
    const cur = { r: null as any, text: '', downAt: Date.now(), cancelled: false };
    cur.r = {
      stop: () => {
        setState('transcribing');
        void (async () => {
          const file = cur.cancelled ? (recorderApi.current.discard(), null) : await recorderApi.current.finish();
          rec.current = null; toggleMode.current = false;
          try {
            if (!file) return;
            const res = await fetch('/api/speech/transcribe', { method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type || 'audio/webm' }, body: await file.arrayBuffer() });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error ?? 'Transcription failed.');
            if (String(j.text ?? '').trim()) cb.current.onText(String(j.text).trim());
          } catch (e) { cb.current.onError((e as Error).message); }
          finally { setState('idle'); }
        })();
      },
    };
    rec.current = cur;
    setState('recording');
    void recorderApi.current.start();
  }, []);

  const begin = useCallback(() => {
    if (rec.current) return;
    if (offline.current) { beginOffline(); return; }
    if (!SpeechRec) { cb.current.onError(UNSUPPORTED); return; }
    const r = new SpeechRec();
    r.lang = recLang(cb.current.language);
    r.continuous = true;
    r.interimResults = false;
    const cur = { r, text: '', downAt: Date.now(), cancelled: false };
    rec.current = cur;
    r.onresult = (e: any) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) cur.text += `${e.results[i][0].transcript} `; };
    r.onerror = (e: any) => { if (e.error !== 'no-speech' && e.error !== 'aborted') { cur.cancelled = true; cb.current.onError(micErrorMessage(e.error)); } };
    r.onend = () => {
      rec.current = null;
      toggleMode.current = false;
      setState('idle');
      const t = cur.text.trim();
      if (!cur.cancelled && t) cb.current.onText(t);
    };
    try { r.start(); setState('recording'); } catch { rec.current = null; cb.current.onError('Could not start the microphone.'); }
  }, [beginOffline]);

  // Press-and-hold records until release; a quick tap toggles recording on, tap again stops.
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (rec.current && toggleMode.current) { finish(); return; }
    begin();
  }, [begin, finish]);

  const onPointerUp = useCallback(() => {
    const cur = rec.current;
    if (!cur || toggleMode.current) return;
    if (Date.now() - cur.downAt < HOLD_MS) toggleMode.current = true;
    else finish();
  }, [finish]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (rec.current) finish();
    else { toggleMode.current = true; begin(); }
  }, [begin, finish]);

  useEffect(() => {
    if (state !== 'recording') return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(true); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [state, finish]);
  useEffect(() => () => finish(true), [finish]);

  return { state, onPointerDown, onPointerUp, onKeyDown, cancel: () => finish(true) };
}
