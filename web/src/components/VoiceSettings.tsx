import { useEffect, useRef, useState } from 'react';
import type { Bot } from '@shared/types';
import { useStore } from '../store';
import { voiceApi, type VoiceOptions } from '../voice/api';
import { endCall, isCallActive, previewVoice, startCall, useVoice } from '../voice/call';
import { listVoices } from '../voice/speech';
import { Icon } from './Icon';
import { VoicePicker, type LocalVoiceStatus } from '../nod/components/voice-picker';
import { speechVoices } from '../shared/speech';
import '../nod/components/voice-settings.css';

const localVoices = speechVoices.filter((v) => v.source === 'local');
const speech = (path = '', body?: unknown, signal?: AbortSignal) =>
  fetch(`/api/speech${path}`, { credentials: 'include', signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });

const FALLBACK: VoiceOptions = {
  languages: [{ code: 'auto', name: 'Auto-detect' }, { code: 'en-US', name: 'English' }],
  speeds: [0.7, 0.85, 1, 1.15, 1.3, 1.5],
};

const speedLabel = (s: number) => `${Number(s.toFixed(2))}x`;

function NativeSelect<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const current = options.find((o) => o.value === value)?.label ?? String(value);
  return (
    <span className="mini-select mini-select--native">
      <span>{current}</span>
      <Icon name="chev_down" size={10} opacity={0.66} />
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          if (o) onChange(o.value);
        }}
      >
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </span>
  );
}

/** "Voice chat" section of the details panel: voice, speed, language (saved per bot), preview, start a call. */
export function VoiceSettings({ bot }: { bot: Bot }) {
  const [opts, setOpts] = useState<VoiceOptions>(FALLBACK);
  const [browserVoices, setBrowserVoices] = useState<{ id: string; name: string }[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [local, setLocal] = useState<LocalVoiceStatus>();
  const [preparing, setPreparing] = useState(false);
  const [prepError, setPrepError] = useState('');
  const prepAbort = useRef<AbortController>();
  const inCall = useVoice((s) => isCallActive(s) && s.botId === bot.id);

  useEffect(() => { voiceApi.options().then(setOpts).catch(() => {}); }, []);
  useEffect(() => { void listVoices().then((v) => setBrowserVoices([{ id: '', name: 'Automatic' }, ...v.map((x) => ({ id: x.voiceURI, name: `${x.name} (${x.lang})` }))])); }, []);
  useEffect(() => setError(null), [bot.id]);
  useEffect(() => { speech().then((r) => r.json()).then((j) => setLocal(j.local)).catch(() => {}); }, []);

  const prepare = async () => {
    prepAbort.current = new AbortController();
    setPreparing(true); setPrepError('');
    try {
      const r = await speech('/prepare', {}, prepAbort.current.signal);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Download failed.');
      setLocal(j.local);
    } catch (e) { if (!prepAbort.current?.signal.aborted) setPrepError((e as Error).message); }
    finally { setPreparing(false); speech().then((r) => r.json()).then((j) => setLocal(j.local)).catch(() => {}); }
  };

  const save = async (patch: Partial<Pick<Bot, 'voice' | 'voiceSpeed' | 'voiceLanguage'>>) => {
    const prev = useStore.getState().bots.find((b) => b.id === bot.id);
    // Optimistic; the server's `bot` event confirms.
    useStore.setState((s) => ({ bots: s.bots.map((b) => (b.id === bot.id ? { ...b, ...patch } : b)) }));
    setError(null);
    try {
      const res = await fetch(`/api/bots/${bot.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      if (prev) useStore.setState((s) => ({ bots: s.bots.map((b) => (b.id === bot.id ? { ...b, voice: prev.voice, voiceSpeed: prev.voiceSpeed, voiceLanguage: prev.voiceLanguage } : b)) }));
      setError('Couldn’t save that setting.');
    }
  };

  const preview = async () => {
    if (previewing) return;
    setPreviewing(true); setError(null);
    try { await previewVoice({ botId: bot.id, voice: bot.voice, speed: bot.voiceSpeed, language: bot.voiceLanguage }); }
    catch (e) { setError((e as Error).message || 'Preview unavailable'); }
    finally { setPreviewing(false); }
  };

  const voices = browserVoices.some((v) => v.id === bot.voice) ? browserVoices : [{ id: bot.voice, name: bot.voice === 'luna' || !bot.voice ? 'Automatic' : bot.voice }, ...browserVoices.filter((v) => v.id !== bot.voice)];
  const speeds = opts.speeds.includes(bot.voiceSpeed) ? opts.speeds : [...opts.speeds, bot.voiceSpeed].sort((a, b) => a - b);

  return (
    <div className="panel-card">
      <div className="panel-row panel-row--setting">
        <span>Voice</span>
        <span className="voice-setting__right">
          <button type="button" className="voice-preview" onClick={preview} disabled={previewing} title={`Hear ${bot.name}'s voice`}>{previewing ? 'Playing…' : 'Preview'}</button>
          <NativeSelect label="Voice" value={bot.voice} options={voices.map((v) => ({ value: v.id, label: v.name }))} onChange={(voice) => save({ voice })} />
        </span>
      </div>
      <div className="panel-row panel-row--setting">
        <span id="voice-local-label">Offline voice</span>
        <VoicePicker
          voices={localVoices}
          value={bot.voice.startsWith('local:') ? bot.voice : null}
          open={pickerOpen}
          disabled={false}
          labelledBy="voice-local-label"
          loading={previewing ? bot.voice : null}
          playing={null}
          error=""
          local={local}
          preparing={preparing}
          preparationError={prepError}
          refreshing={false}
          providers={[]}
          onOpenChange={setPickerOpen}
          onChange={(v) => { if (v) void save({ voice: v }); }}
          onPreview={(v) => { void save({ voice: v }).then(preview); }}
          onStop={() => {}}
          onPrepare={prepare}
          onCancelPreparation={() => prepAbort.current?.abort()}
          onConnect={() => {}}
          onRefresh={() => {}}
        />
      </div>
      <div className="panel-row panel-row--setting">
        <span>Speed</span>
        <NativeSelect label="Speed" value={bot.voiceSpeed} options={speeds.map((s) => ({ value: s, label: speedLabel(s) }))} onChange={(voiceSpeed) => save({ voiceSpeed })} />
      </div>
      <div className="panel-row panel-row--setting">
        <span>Language</span>
        <NativeSelect label="Language" value={bot.voiceLanguage} options={opts.languages.map((l) => ({ value: l.code, label: l.name }))} onChange={(voiceLanguage) => save({ voiceLanguage })} />
      </div>
      <button type="button" className={`panel-row panel-row--action panel-row--call${inCall ? ' is-active' : ''}`} onClick={() => (inCall ? endCall() : startCall(bot.id))}>
        <Icon name="voice_a" size={14} opacity={inCall ? 1 : 0.56} /> {inCall ? 'End voice chat' : 'Start voice chat'}
      </button>
      {error && <div className="voice-error">{error}</div>}
    </div>
  );
}
