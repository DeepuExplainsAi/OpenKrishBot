import { useCallback, useEffect, useState } from 'react';

interface Provider { id: string; name: string; group: string; connected: boolean; cli: boolean; canLogin: boolean; hasKey: boolean; keyless: boolean; local: boolean; models: string[]; note: string | null; baseUrl: string; env: string | null }

const GROUPS = ['Your subscription', 'On this computer', 'Free tiers', 'API keys'];
const call = async (method: string, url: string, body?: unknown) => {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
};

function Row({ p, onChange }: { p: Provider; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [url, setUrl] = useState(p.baseUrl);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (what: string, fn: () => Promise<string | void>) => {
    setBusy(what); setNote(null);
    try { const text = await fn(); if (text) setNote({ ok: true, text }); onChange(); } catch (e) { setNote({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  };
  const save = () => call('PUT', `/api/krish/providers/${p.id}`, { ...(key ? { apiKey: key } : {}), ...(url !== p.baseUrl ? { baseUrl: url } : {}) }).then(() => setKey(''));
  const needsKey = !p.keyless && !p.cli;
  return (
    <div className="cfg-card__item">
      <div className="cfg-row">
        <div className="cfg-row__text">
          <div className="cfg-row__title">{p.name}</div>
          <div className="cfg-row__sub">{p.cli && !p.connected ? `Not found on this computer. ${p.note ?? ''}` : p.note ?? (p.models.length ? `${p.models.length} models` : '')}</div>
        </div>
        {p.connected && <span className="cfg-chip">{p.cli ? 'Ready' : 'Connected'}</span>}
        <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => setOpen(!open)}>{open ? 'Close' : p.connected ? 'Edit' : 'Set up'}</button>
      </div>
      {open && (
        <div className="cfg-form">
          {p.canLogin && <button type="button" className="cfg-btn cfg-btn--secondary" disabled={!!busy} onClick={() => run('login', async () => { const r = await call('POST', `/api/krish/providers/${p.id}/login`); return `To sign in, run this in a terminal yourself, then press Test: ${r.command}`; })}>Sign in with your account</button>}
          {needsKey && <><label className="cfg-field__label">API key{p.env ? ` (or ${p.env})` : ''}</label><input className="text-input" type="password" value={key} placeholder={p.hasKey ? 'Saved. Type to replace.' : 'Paste your key'} autoComplete="off" onChange={(e) => setKey(e.target.value)} /></>}
          {!p.cli && <><label className="cfg-field__label">Address</label><input className="text-input" value={url} placeholder="https://…/v1" spellCheck={false} onChange={(e) => setUrl(e.target.value)} /></>}
          {p.models.length > 0 && <div className="cfg-field__hint">Models: {p.models.slice(0, 6).join(', ')}{p.models.length > 6 ? ` and ${p.models.length - 6} more` : ''}. Pick one in the chat's Engine panel.</div>}
          {note && <div className={note.ok ? 'cfg-field__hint' : 'cfg-error cfg-error--small'}>{note.text}</div>}
          <div className="cfg-form__actions">
            {!p.cli && <button type="button" className="cfg-btn cfg-btn--primary" disabled={!!busy} onClick={() => run('save', async () => { await save(); return 'Saved.'; })}>{busy === 'save' ? 'Saving…' : 'Save'}</button>}
            <button type="button" className="cfg-btn cfg-btn--secondary" disabled={!!busy} onClick={() => run('test', async () => { if (!p.cli) await save(); const r = await call('POST', `/api/krish/providers/${p.id}/test`); return `Works${r.model ? ` (${r.model})` : ''}. It answered: “${r.reply}”`; })}>{busy === 'test' ? 'Testing…' : p.cli ? 'Test' : 'Save and test'}</button>
            {p.hasKey && <button type="button" className="cfg-btn cfg-btn--ghost-danger" disabled={!!busy} onClick={() => run('rm', async () => { await call('PUT', `/api/krish/providers/${p.id}`, { apiKey: '' }); })}>Remove key</button>}
          </div>
        </div>
      )}
    </div>
  );
}

export function ModelsSection() {
  const [list, setList] = useState<Provider[] | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { call('GET', '/api/krish/providers?fresh=1').then((r) => setList(r.providers)).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div className="app-settings__head"><h1>Models</h1><p>Connect the AI your Bots think with: a plan you already pay for, one on this computer, a free tier, or your own key. Requests go straight from this computer.</p></div>
      {err ? <div className="cfg-error">{err}</div> : !list ? <div className="cfg-empty cfg-empty--flat">Loading…</div> : GROUPS.map((g) => (
        <section key={g} className="cfg-section">
          <div className="cfg-section__label">{g}</div>
          <div className="cfg-card">{list.filter((p) => p.group === g).map((p) => <Row key={p.id} p={p} onChange={load} />)}</div>
        </section>
      ))}
    </>
  );
}
