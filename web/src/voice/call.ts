// Voice chat: you talk, the browser transcribes (free speech recognition), the text goes to the bot like a typed
// message, and the bot's reply is read aloud (free speech synthesis). Same bot, same memory, same tools, no cloud.
import { create } from 'zustand';
import { api } from '../lib/api';
import { sortedRows, useStore } from '../store';
import { SpeechRec, UNSUPPORTED, micErrorMessage, recLang, speak } from './speech';

export interface Caption { id: string; role: 'user' | 'assistant'; text: string; final: boolean }
export type CallStatus = 'idle' | 'connecting' | 'live' | 'ending' | 'error';

interface VoiceState {
  status: CallStatus;
  botId: string | null;
  callId: string | null;
  muted: boolean;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  working: { seq: number; request: string }[];
  captions: Caption[];
  error: string | null;
  startedAt: number | null;
}

export const useVoice = create<VoiceState>(() => ({
  status: 'idle', botId: null, callId: null, muted: false, speaking: false, listening: false, thinking: false,
  working: [], captions: [], error: null, startedAt: null,
}));

const setV = (p: Partial<VoiceState>) => useVoice.setState(p);
let current: VoiceCall | null = null;
let capId = 0;

/** Start a call with a bot. Call from a click so the browser allows the microphone and audio. */
export function startCall(botId: string) {
  if (current && !current.ended) {
    if (current.botId === botId) return;
    current.end();
  }
  current = new VoiceCall(botId);
  current.start();
}

export function endCall() { current?.end(); }
export function toggleMute() { current?.setMuted(!useVoice.getState().muted); }
export function callLevels(): { out: number; mic: number } {
  const v = useVoice.getState();
  return current && !current.ended ? { out: v.speaking ? 0.35 + Math.random() * 0.4 : 0, mic: v.listening ? 0.25 + Math.random() * 0.15 : 0 } : { out: 0, mic: 0 };
}
export const isCallActive = (s: VoiceState = useVoice.getState()) => s.status === 'connecting' || s.status === 'live';

class VoiceCall {
  ended = false;
  private rec: any = null;
  private abort = new AbortController();
  private busy = false;
  private unsub: (() => void) | null = null;

  constructor(readonly botId: string) {}

  private bot() { return useStore.getState().bots.find((b) => b.id === this.botId); }

  start() {
    if (!SpeechRec) return this.end(UNSUPPORTED);
    setV({ status: 'live', botId: this.botId, callId: `call_${Date.now()}`, muted: false, speaking: false, listening: false, thinking: false, working: [], captions: [], error: null, startedAt: Date.now() });
    this.listen();
  }

  private listen() {
    if (this.ended || this.busy || useVoice.getState().muted) { setV({ listening: false }); return; }
    const r = new SpeechRec();
    this.rec = r;
    r.lang = recLang(this.bot()?.voiceLanguage);
    r.continuous = false;
    r.interimResults = true;
    let heard = '';
    r.onstart = () => setV({ listening: true });
    r.onresult = (e: any) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      heard = t.trim();
    };
    r.onerror = (e: any) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.end(micErrorMessage(e.error));
    };
    r.onend = () => {
      setV({ listening: false });
      if (this.ended) return;
      if (heard) void this.turn(heard); else setTimeout(() => this.listen(), 150);
    };
    try { r.start(); } catch { setTimeout(() => this.listen(), 400); }
  }

  private caption(role: Caption['role'], text: string) {
    setV({ captions: [...useVoice.getState().captions, { id: `c${++capId}`, role, text, final: true }].slice(-40) });
  }

  private async turn(text: string) {
    this.busy = true;
    this.caption('user', text);
    setV({ thinking: true });
    try {
      const { row } = await api.send(this.botId, text);
      const reply = await this.waitForReply(row.seq);
      setV({ thinking: false });
      if (this.ended) return;
      if (reply) {
        this.caption('assistant', reply);
        setV({ speaking: true });
        const b = this.bot();
        await speak(reply, { voice: b?.voice, speed: b?.voiceSpeed, language: b?.voiceLanguage }, this.abort.signal).catch((e) => this.caption('assistant', `(${(e as Error).message})`));
        setV({ speaking: false });
      }
    } catch (e) {
      setV({ thinking: false });
      this.caption('assistant', `(${(e as Error).message || 'Message failed to send'})`);
    } finally {
      this.busy = false;
      if (!this.ended) this.listen();
    }
  }

  /** Resolves with the bot's written reply once its turn is over (approval waits are announced, then waited out). */
  private waitForReply(afterSeq: number): Promise<string> {
    return new Promise((resolve) => {
      let announced = false;
      let idleSince: number | null = null;
      const check = () => {
        if (this.ended) return done('');
        const st = useStore.getState();
        const live = st.live[this.botId];
        const rows = sortedRows(st.transcripts[this.botId]).filter((r) => r.seq > afterSeq);
        const replies = rows.filter((r) => r.body.type === 'message' && r.body.role === 'assistant');
        const streaming = replies.some((r) => r.body.type === 'message' && r.body.streaming);
        if (live?.awaiting && !announced) {
          announced = true;
          void speak('This needs your OK on screen.', { voice: this.bot()?.voice, speed: this.bot()?.voiceSpeed, language: this.bot()?.voiceLanguage }, this.abort.signal);
        }
        const over = !live?.isRunning && !streaming && !live?.awaiting;
        if (over && replies.length) {
          idleSince ??= Date.now();
          if (Date.now() - idleSince > 1200) return done(replies.map((r) => (r.body.type === 'message' ? r.body.text : '')).join('\n\n').trim());
        } else idleSince = null;
      };
      const done = (t: string) => { this.unsub?.(); clearInterval(timer); clearTimeout(cap); resolve(t); };
      this.unsub = useStore.subscribe(check);
      const timer = setInterval(check, 700);
      const cap = setTimeout(() => done(''), 15 * 60_000);
    });
  }

  setMuted(m: boolean) {
    setV({ muted: m });
    if (m) { try { this.rec?.abort(); } catch { /* ignore */ } setV({ listening: false }); }
    else if (!this.busy) this.listen();
  }

  end(error?: string) {
    if (this.ended) return;
    this.ended = true;
    this.abort.abort();
    this.unsub?.();
    try { this.rec?.abort(); } catch { /* ignore */ }
    window.speechSynthesis?.cancel();
    if (current === this) current = null;
    if (error) {
      setV({ status: 'error', error, speaking: false, listening: false, thinking: false, working: [] });
      setTimeout(() => { if (useVoice.getState().status === 'error' && !current) setV({ status: 'idle', botId: null, error: null }); }, 6000);
    } else setV({ status: 'idle', botId: null, callId: null, speaking: false, listening: false, thinking: false, working: [], startedAt: null });
  }
}

/** Speak a short sample with the bot's voice settings. */
export async function previewVoice(p: { botId: string; voice?: string; speed?: number; language?: string }): Promise<void> {
  const name = useStore.getState().bots.find((b) => b.id === p.botId)?.name ?? 'your bot';
  await speak(`Hi, I'm ${name}. This is how I sound.`, p);
}
