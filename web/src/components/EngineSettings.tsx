import { useConfigUI } from '../configStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bot, EngineInfo, EngineProvider } from '@shared/types';
import { configApi, type BudgetInfo } from '../lib/configApi';
import { useStore } from '../store';
import { Icon } from './Icon';

const STATUS: Record<EngineInfo['status'], string> = { ready: 'ready', starting: 'starting', stopped: 'stopped', error: 'error' };

/** Connected providers first; otherwise the server's order. */
function sortProviders(list: EngineProvider[]): EngineProvider[] {
  return [...list].sort((a, b) => Number(b.connected) - Number(a.connected));
}

/**
 * "Engine" section of the details panel: which provider and model run this bot's agent, signing in to
 * a subscription, and the agent's status. Every call fails soft: if the engine endpoints are missing or
 * down, the section says so and the rest of the panel is unaffected.
 */
export function EngineSettings({ bot }: { bot: Bot }) {
  const viewerOpen = useStore((s) => s.viewerOpen);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'unavailable'>('loading');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState<'save' | 'signin' | 'restart' | 'screen' | 'key' | 'refresh' | null>(null);
  const [custom, setCustom] = useState(false);
  const [keyText, setKeyText] = useState('');
  const [urlText, setUrlText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const dirty = useRef(false);
  const botId = bot.id;

  const apply = useCallback((e: EngineInfo, keepDraft = false) => {
    setEngine(e); setPhase('ok');
    if (!keepDraft || !dirty.current) { dirty.current = false; setProvider(e.provider ?? ''); setModel(e.model ?? ''); }
    // Keep the bot's model label in step without waiting for the server's `bot` event.
    useStore.setState((s) => ({ bots: s.bots.map((b) => (b.id === e.botId && (b.model !== e.model || b.provider !== e.provider) ? { ...b, model: e.model, provider: e.provider } : b)) }));
  }, []);

  /** Quiet refreshes keep what is on screen if the call fails. */
  const load = useCallback((quiet = false) => {
    let alive = true;
    if (!quiet) setPhase('loading');
    configApi.engine(botId)
      .then((r) => { if (alive && r?.engine) apply(r.engine, quiet); else if (alive && !quiet) setPhase('unavailable'); })
      .catch(() => { if (alive && !quiet) setPhase('unavailable'); });
    return () => { alive = false; };
  }, [botId, apply]);

  useEffect(() => { dirty.current = false; setCustom(false); setEngine(null); setNote(null); setSigningIn(false); return load(); }, [load]);

  // The agent takes a moment to come up after a change or a restart.
  const starting = engine?.status === 'starting';
  useEffect(() => {
    if (!starting) return;
    const t = setInterval(() => load(true), 3000);
    return () => clearInterval(t);
  }, [starting, load]);

  // Signing in happens on the bot's computer. Check while that view is open, and once more when it closes.
  useEffect(() => {
    if (!signingIn) return;
    if (!viewerOpen) { setSigningIn(false); load(true); return; }
    const t = setInterval(() => load(true), 5000);
    return () => clearInterval(t);
  }, [signingIn, viewerOpen, load]);

  if (phase !== 'ok' || !engine) {
    return (
      <div className="panel-card">
        <div className="panel-empty engine__empty">
          {phase === 'loading' ? 'Checking…' : (
            <>
              <span>Engine unavailable</span>
              <button type="button" className="link-btn link-btn--small" onClick={() => load()}>Try again</button>
            </>
          )}
        </div>
      </div>
    );
  }

  const providers = sortProviders(engine.providers ?? []);
  const selected = providers.find((p) => p.id === provider) ?? null;
  const suggestions = selected?.models ?? [];
  const wantProvider = provider && provider !== (engine.provider ?? '') ? provider : undefined;
  const wantModel = model.trim() && model.trim() !== (engine.model ?? '') ? model.trim() : undefined;
  const changed = !!wantProvider || !!wantModel;
  const listId = `engine-models-${botId}`;

  const pickProvider = (id: string) => {
    dirty.current = true; setNote(null); setProvider(id);
    const next = providers.find((p) => p.id === id);
    // A model from another provider will not work here, so start from this provider's first suggestion.
    if (next?.models.length && !next.models.includes(model.trim())) setModel(next.models[0]);
  };

  const save = async () => {
    if (!changed || busy) return;
    setBusy('save'); setNote(null);
    try { const r = await configApi.setEngine(botId, { ...(wantProvider ? { provider: wantProvider } : {}), ...(wantModel ? { model: wantModel } : {}) }); dirty.current = false; apply(r.engine); }
    catch (e) { setNote(`Couldn’t save: ${(e as Error).message || 'the engine did not answer'}`); }
    finally { setBusy(null); }
  };

  const saveKey = async (id: string) => {
    if (!keyText.trim() || busy) return;
    setBusy('key'); setNote(null);
    try { await fetch(`/api/krish/providers/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: keyText }) }); setKeyText(''); await load(true); }
    catch (e) { setNote(`Couldn’t save the key: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };
  const saveUrl = async (id: string) => {
    if (busy) return;
    setBusy('key'); setNote(null);
    try { await fetch(`/api/krish/providers/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseUrl: urlText }) }); await load(true); }
    catch (e) { setNote(`Couldn’t save the address: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };

  const refreshModels = async () => {
    if (busy) return;
    setBusy('refresh'); setNote(null);
    try { await fetch('/api/krish/providers?fresh=1'); await load(true); }
    catch (e) { setNote(`Couldn’t refresh: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };

  const restart = async () => {
    if (busy) return;
    setBusy('restart'); setNote(null);
    try { const r = await configApi.restartEngine(botId); apply(r.engine, true); }
    catch (e) { setNote(`Couldn’t restart: ${(e as Error).message || 'the engine did not answer'}`); }
    finally { setBusy(null); }
  };

  const useThisScreen = async () => {
    if (busy) return;
    setBusy('screen'); setNote(null);
    try { const r = await configApi.stopOwnScreen(botId); apply(r.engine, true); }
    catch (e) { setNote(`Couldn’t switch screens: ${(e as Error).message || 'the engine did not answer'}`); }
    finally { setBusy(null); }
  };

  return (
    <div className="panel-card engine">
      <div className="panel-row panel-row--setting">
        <span>Provider</span>
        <span className="mini-select mini-select--native engine__select">
          <span>{selected?.name ?? (provider || 'Default')}</span>
          <Icon name="chev_down" size={10} opacity={0.66} />
          <select aria-label="Provider" value={provider} onChange={(e) => pickProvider(e.target.value)}>
            {!selected && <option value={provider}>{provider || 'Default'}</option>}
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.connected ? 'Ready' : 'Needs key'}</option>)}
          </select>
        </span>
      </div>
      {selected && (
        <div className={`engine__conn${selected.connected ? ' is-on' : ''}`}>
          <i aria-hidden />
          <span>{selected.connected ? 'Ready' : 'Needs an API key'}</span>
        </div>
      )}
      <div className="panel-row panel-row--setting">
        <label htmlFor={`${listId}-input`}>Model</label>
        <span className="engine__modelbox">
          {suggestions.length > 0 && !custom ? (
            <span className="mini-select mini-select--native engine__select">
              <span>{model || suggestions[0]}</span>
              <Icon name="chev_down" size={10} opacity={0.66} />
              <select id={`${listId}-input`} aria-label="Model" value={model} onChange={(e) => { if (e.target.value === '__custom') { setCustom(true); return; } dirty.current = true; setNote(null); setModel(e.target.value); }}>
                {model && !suggestions.includes(model) && <option value={model}>{model}</option>}
                {suggestions.map((m) => <option key={m} value={m}>{m}</option>)}
                <option value="__custom">Type another model…</option>
              </select>
            </span>
          ) : (
            <input
              id={`${listId}-input`} className="engine__model" value={model} spellCheck={false} autoComplete="off"
              placeholder={suggestions[0] ?? 'Model id'}
              onChange={(e) => { dirty.current = true; setNote(null); setModel(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            />
          )}
          <button type="button" className="engine__refresh" aria-label="Refresh models" title="Refresh models" disabled={busy === 'refresh'} onClick={refreshModels}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={busy === 'refresh' ? 'is-spinning' : ''}><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></svg>
          </button>
        </span>
      </div>
      <div className="engine__actions">
        <button type="button" className="btn btn--sm btn--bot" onClick={save} disabled={!changed || busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
        {changed && <button type="button" className="link-btn link-btn--small" onClick={() => { dirty.current = false; setNote(null); setProvider(engine.provider ?? ''); setModel(engine.model ?? ''); }}>Undo</button>}
      </div>
      {selected && !selected.connected && selected.id !== 'ollama' && selected.id !== 'lmstudio' && selected.id !== 'llamacpp' && (
        <div className="panel-row panel-row--setting">
          <label htmlFor={`${listId}-key`}>API key</label>
          <input id={`${listId}-key`} className="engine__model" type="password" value={keyText} spellCheck={false} autoComplete="off" placeholder="Paste key, then Enter"
            onChange={(e) => setKeyText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveKey(selected.id); }} />
        </div>
      )}
      {selected && (selected.id === 'custom' || selected.id === 'ollama' || selected.id === 'lmstudio' || selected.id === 'llamacpp') && (
        <div className="panel-row panel-row--setting">
          <label htmlFor={`${listId}-url`}>Address</label>
          <input id={`${listId}-url`} className="engine__model" value={urlText} spellCheck={false} placeholder="http://127.0.0.1:11434/v1"
            onChange={(e) => setUrlText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveUrl(selected.id); }} />
        </div>
      )}
      {engine.ownScreen && (
        <div className="engine__notice">
          <span>{bot.name} also has a private screen of its own switched on. Desktop work it does there (clicking around apps) will not show on the screen here.</span>
          <button type="button" className="link-btn link-btn--small" onClick={useThisScreen} disabled={busy === 'screen'}>{busy === 'screen' ? 'Switching…' : 'Use this screen'}</button>
        </div>
      )}
      {note && <div className="voice-error" role="alert">{note}</div>}
      <div className="engine__meta">
        <span className={`engine__state is-${engine.status}`} title="OpenKrishBot engine">
          <i aria-hidden />
          OpenKrishBot engine · {STATUS[engine.status] ?? engine.status}
        </span>
        {(engine.status === 'error' || engine.status === 'stopped') && (
          <button type="button" className="link-btn link-btn--small" onClick={restart} disabled={busy === 'restart'}>{busy === 'restart' ? 'Restarting…' : 'Restart agent'}</button>
        )}
      </div>
      {engine.status === 'error' && engine.error && <div className="engine__error">{engine.error}</div>}
      <BudgetRow botId={bot.id} />
      <QueueRow botId={bot.id} />
      <ScriptsRow botId={bot.id} />
    </div>
  );
}

/** Messages waiting for this Bot, in order: pause the line or drop waiting ones. */
function QueueRow({ botId }: { botId: string }) {
  const version = useConfigUI((s) => s.versions[`queue:${botId}`] ?? 0);
  const [q, setQ] = useState<Awaited<ReturnType<typeof configApi.queue>> | null>(null);
  useEffect(() => { configApi.queue(botId).then(setQ).catch(() => setQ(null)); }, [botId, version]);
  if (!q || (!q.paused && !q.pending.length)) return null;
  const act = (a: 'pause' | 'resume' | 'cancel', id?: number) => configApi.queueAction(botId, a, id).then(setQ).catch(() => {});
  return (
    <div className="engine__meta" style={{ flexWrap: 'wrap', gap: 6 }}>
      <span>Waiting: {q.pending.length}{q.paused ? ' (paused)' : ''}</span>
      <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => act(q.paused ? 'resume' : 'pause')}>{q.paused ? 'Resume' : 'Pause'}</button>
      {q.pending.length > 0 && <button type="button" className="cfg-btn cfg-btn--ghost-danger" onClick={() => act('cancel')}>Cancel all</button>}
      {q.pending.map((p) => <button key={p.id} type="button" className="cfg-btn cfg-btn--ghost" title="Cancel this one" onClick={() => act('cancel', p.id)}>✕ {p.label.slice(0, 40)}</button>)}
    </div>
  );
}

/** Local scripts: a program on this computer can message this Bot with a private token (shown once). Off by default. */
function ScriptsRow({ botId }: { botId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { setToken(''); configApi.scripts(botId).then((r) => setOn(r.enabled)).catch(() => setOn(null)); }, [botId]);
  if (on === null) return null;
  const make = () => configApi.enableScripts(botId).then((r) => { setOn(true); setToken(r.token); setErr(''); }).catch((e) => setErr(e.message));
  const off = () => configApi.disableScripts(botId).then(() => { setOn(false); setToken(''); }).catch((e) => setErr(e.message));
  return (
    <div className="engine__meta" style={{ flexWrap: 'wrap', gap: 6 }}>
      <span>Local scripts: {on ? 'on' : 'off'}</span>
      <button type="button" className="cfg-btn cfg-btn--secondary" onClick={make}>{on ? 'New token' : 'Turn on'}</button>
      {on && <button type="button" className="cfg-btn cfg-btn--ghost-danger" onClick={off}>Turn off</button>}
      {token && <code style={{ wordBreak: 'break-all' }}>curl -s -H "Authorization: Bearer {token}" -d '{'{"text":"hello","wait":120}'}' http://127.0.0.1:8787/script/messages</code>}
      {err && <span className="voice-error" role="alert">{err}</span>}
    </div>
  );
}

/** Today's token use and an optional daily cap; at the cap the Bot says so instead of calling the model. */
function BudgetRow({ botId }: { botId: string }) {
  const [info, setInfo] = useState<BudgetInfo | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () => configApi.budget(botId).then((r) => { if (alive) { setInfo(r); setText((t) => (t === '' && r.dailyTokens ? String(r.dailyTokens) : t)); } }).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, [botId]);
  if (!info) return null;
  const used = info.today.tokensIn + info.today.tokensOut;
  const save = () => {
    const n = text.trim() === '' ? null : Number(text.replace(/[, ]/g, ''));
    if (n !== null && !(n >= 0)) { setErr('Enter a number, or leave empty for no limit.'); return; }
    configApi.setBudget(botId, n).then((r) => { setInfo(r); setErr(''); }).catch((e) => setErr(e.message));
  };
  return (
    <div className="engine__meta" style={{ flexWrap: 'wrap', gap: 6 }}>
      <span>Today: {used.toLocaleString()} tokens · {info.today.calls} calls{info.dailyTokens ? ` · limit ${info.dailyTokens.toLocaleString()}` : ''}</span>
      <input className="text-input" style={{ width: 130 }} inputMode="numeric" placeholder="Daily limit" aria-label="Daily token limit" value={text} onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} />
      {err && <span className="voice-error" role="alert">{err}</span>}
      <PriceRow botId={botId} info={info} onSaved={setInfo} />
    </div>
  );
}

/** Optional: what this model costs (USD per million tokens). Free providers: leave empty and cost stays 0. */
function PriceRow({ botId, info, onSaved }: { botId: string; info: BudgetInfo; onSaved: (i: BudgetInfo) => void }) {
  const [inP, setIn] = useState(info.price ? String(info.price.inPerM) : '');
  const [outP, setOut] = useState(info.price ? String(info.price.outPerM) : '');
  const [err, setErr] = useState('');
  const save = () => {
    const a = inP.trim() === '' ? 0 : Number(inP), b = outP.trim() === '' ? 0 : Number(outP);
    if (!(a >= 0) || !(b >= 0)) { setErr('Prices are numbers, in USD per million tokens.'); return; }
    configApi.setPrice(botId, a || b ? { inPerM: a, outPerM: b } : null).then((r) => { onSaved(r); setErr(''); }).catch((e) => setErr(e.message));
  };
  return (
    <>
      <span>{info.price ? `Cost today ≈ $${info.today.costUsd.toFixed(info.today.costUsd < 0.01 ? 4 : 2)}` : 'Free model'}</span>
      <input className="text-input" style={{ width: 90 }} inputMode="decimal" placeholder="$ in /1M" aria-label="Price per million input tokens" value={inP} onChange={(e) => setIn(e.target.value)} onBlur={save} />
      <input className="text-input" style={{ width: 90 }} inputMode="decimal" placeholder="$ out /1M" aria-label="Price per million output tokens" value={outP} onChange={(e) => setOut(e.target.value)} onBlur={save} />
      {err && <span className="voice-error" role="alert">{err}</span>}
    </>
  );
}
