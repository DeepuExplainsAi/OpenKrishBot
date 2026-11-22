// Composer dictation: hold the mic to talk (or tap to start, tap again to stop). Uses the browser's free speech
// recognition, so nothing is uploaded to a Krishbot server and no key is needed.
import { useCallback, useEffect, useRef, useState } from 'react';
import { SpeechRec, UNSUPPORTED, micErrorMessage, recLang } from './speech';

export type DictationState = 'idle' | 'recording' | 'transcribing';

const HOLD_MS = 350;

export function useDictation(onText: (text: string) => void, onError: (msg: string) => void, language?: string) {
  const [state, setState] = useState<DictationState>('idle');
  const rec = useRef<{ r: any; text: string; downAt: number; cancelled: boolean } | null>(null);
  const toggleMode = useRef(false);
  const cb = useRef({ onText, onError, language });
  cb.current = { onText, onError, language };

  const finish = useCallback((cancel = false) => {
    const cur = rec.current;
    if (!cur) return;
    cur.cancelled = cancel;
    try { cur.r.stop(); } catch { /* already stopped */ }
  }, []);

  const begin = useCallback(() => {
    if (rec.current) return;
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
  }, []);

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
