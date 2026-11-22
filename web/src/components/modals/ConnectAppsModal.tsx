import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Toolkit } from '@shared/types';
import { BotAvatarFor } from '../../avatar/BotAvatar';
import { api, type AppsResponse } from '../../lib/api';
import { useStore } from '../../store';
import { Icon } from '../Icon';
import { Menu } from '../Menu';
import { ToolkitLogo } from '../ToolkitLogo';
import { BOT_TEMPLATES, type BotTemplate } from '../../lib/templates';
import { Modal } from './Modal';

/** Design pill → app category. */
const PILLS: { label: string; category: string }[] = [
  { label: 'Password Managers', category: 'security & identity tools' },
  { label: 'Productivity', category: 'productivity' },
  { label: 'Communication', category: 'communication' },
  { label: 'Design', category: 'images & design' },
  { label: 'Code', category: 'developer tools' },
];
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bAi\b/g, 'AI').replace(/\bCrm\b/g, 'CRM').replace(/\bSeo\b/g, 'SEO').replace(/\bIt\b/g, 'IT').replace(/\bHr\b/g, 'HR').replace(/\bSms\b/g, 'SMS').replace(/\bUrl\b/g, 'URL').replace(/\bOcr\b/g, 'OCR');
const pillLabel = (cat: string) => PILLS.find((p) => p.category === cat)?.label ?? titleCase(cat);

type View = { kind: 'all' } | { kind: 'category'; category: string } | { kind: 'connected' };

function AppRow({ app, onChanged }: { app: Toolkit; onChanged: () => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'waiting' | 'confirm'>('idle');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setState('idle'); }, [app.connected]);

  const [form, setForm] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const needs = app.needs ?? [];
  const connect = async () => {
    if (needs.length && !form) { setForm(true); return; }
    setState('busy'); setError(null);
    try { await api.connect(app.slug, values); setForm(false); onChanged(); }
    catch (e) { setError((e as Error).message || 'Couldn’t connect'); setState('idle'); }
  };
  const disconnect = async () => {
    if (state !== 'confirm') { setState('confirm'); return; }
    setState('busy');
    try { await api.disconnect(app.slug); onChanged(); } catch (e) { setError((e as Error).message); setState('idle'); }
  };

  return (
    <div className={`app-row${form ? ' has-form' : ''}`} title={app.description}>
      <ToolkitLogo name={app.name} logo={app.logo} />
      <span className="app-row__text">
        <span className="app-row__name">{app.name}</span>
        {error ? <span className="app-row__error" title={error}>{error}</span> : app.description && <span className="app-row__desc">{app.description}</span>}
      </span>
      {app.connected ? (
        <button type="button" className={`app-row__connected${state === 'confirm' ? ' is-confirm' : ''}`} onClick={disconnect} onMouseLeave={() => state === 'confirm' && setState('idle')} disabled={state === 'busy'}>
          {state === 'confirm' ? 'Disconnect?' : <><Icon name="check" size={12} opacity={0.56} /><span className="app-row__connected-label">Connected</span><span className="app-row__disconnect-label">Disconnect</span></>}
        </button>
      ) : app.noAuth ? (
        <span className="app-row__connected is-static"><Icon name="check" size={12} opacity={0.56} />Built in</span>
      ) : (
        !form && (
          <button type="button" className="app-row__connect" onClick={connect} disabled={state === 'busy'}>
            {state === 'busy' ? 'Starting…' : 'Connect'}
          </button>
        )
      )}
      {form && !app.connected && (
        <form className="app-row__form" onSubmit={(e) => { e.preventDefault(); connect(); }}>
          {needs.map((n) => (
            <label key={n.key} className="app-row__field">
              <span className="cfg-field__label">{n.label}</span>
              <input className="text-input" type={n.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} value={values[n.key] ?? ''} onChange={(e) => setValues({ ...values, [n.key]: e.target.value })} />
            </label>
          ))}
          <div className="cfg-form__actions">
            <button type="submit" className="app-row__connect" disabled={state === 'busy'}>{state === 'busy' ? 'Testing…' : 'Save & test'}</button>
            <button type="button" className="link-btn link-btn--small" onClick={() => { setForm(false); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function Grid({ apps, onChanged }: { apps: Toolkit[]; onChanged: () => void }) {
  return (
    <div className="app-grid">
      {apps.map((a) => <AppRow key={a.slug} app={a} onChanged={onChanged} />)}
    </div>
  );
}

function Section({ title, apps, onViewAll, onChanged }: { title: string; apps: Toolkit[]; onViewAll?: () => void; onChanged: () => void }) {
  if (!apps.length) return null;
  return (
    <section className="apps-section">
      <div className="apps-section__head">
        <span className="apps-section__title">{title}</span>
        {onViewAll && <button type="button" className="link-btn link-btn--small" onClick={onViewAll}>View all</button>}
      </div>
      <Grid apps={apps} onChanged={onChanged} />
    </section>
  );
}

function CustomApp({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<'mcp' | 'http'>('mcp');
  const [f, setF] = useState({ name: '', command: '', args: '', url: '', method: 'GET', headers: '', body: '', description: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true); setErr(null);
    const mcpUrl = kind === 'mcp' && /^https?:/.test(f.command.trim());
    const app = kind === 'http' ? { kind, name: f.name, url: f.url, method: f.method, headers: f.headers, body: f.body, description: f.description }
      : mcpUrl ? { kind, name: f.name, url: f.command.trim() }
      : { kind, name: f.name, command: f.command.trim().split(/\s+/)[0], args: [...f.command.trim().split(/\s+/).slice(1), ...f.args.split('\n').map((a) => a.trim()).filter(Boolean)] };
    try { await api.addCustomApp(app); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="apps-section">
      <div className="apps-section__head"><span className="apps-section__title">Add your own</span></div>
      <div className="custom-app">
        <div className="cat-pills">
          <button type="button" className={`cat-pill${kind === 'mcp' ? ' is-active' : ''}`} onClick={() => setKind('mcp')}>MCP server</button>
          <button type="button" className={`cat-pill${kind === 'http' ? ' is-active' : ''}`} onClick={() => setKind('http')}>Web API</button>
        </div>
        <input className="text-input" placeholder="Name" value={f.name} onChange={(e) => set('name', e.target.value)} />
        {kind === 'mcp' ? (
          <input className="text-input" placeholder="Command (npx -y some-mcp-server) or https:// address" spellCheck={false} value={f.command} onChange={(e) => set('command', e.target.value)} />
        ) : (
          <>
            <input className="text-input" placeholder="URL, e.g. https://api.example.com/items/{id}" spellCheck={false} value={f.url} onChange={(e) => set('url', e.target.value)} />
            <select className="text-input" value={f.method} onChange={(e) => set('method', e.target.value)}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}</select>
            <textarea className="text-input" rows={2} placeholder={'Headers, one per line\nAuthorization: Bearer …'} spellCheck={false} value={f.headers} onChange={(e) => set('headers', e.target.value)} />
            <textarea className="text-input" rows={2} placeholder="Body (optional). Use {name} for values the Bot fills in." spellCheck={false} value={f.body} onChange={(e) => set('body', e.target.value)} />
            <input className="text-input" placeholder="What it does (so the Bot knows when to use it)" value={f.description} onChange={(e) => set('description', e.target.value)} />
          </>
        )}
        {err && <div className="app-row__error">{err}</div>}
        <button type="button" className="app-row__connect" disabled={busy || !f.name.trim()} onClick={save}>{busy ? 'Checking…' : 'Add'}</button>
      </div>
    </section>
  );
}

export function ConnectAppsModal() {
  const setModal = useStore((s) => s.setModal);
  const connectionsVersion = useStore((s) => s.connectionsVersion);
  const primary = useStore((s) => s.bots.find((b) => b.isPrimary));
  const close = useCallback(() => setModal(null), [setModal]);
  const [view, setView] = useState<View>({ kind: 'all' });
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [data, setData] = useState<AppsResponse | null>(null);
  const [connectedApps, setConnectedApps] = useState<Toolkit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const addTemplate = async (t: BotTemplate) => {
    setTemplateError(null);
    try {
      const { bot } = await api.createBot({ name: t.name, label: t.label, instructions: t.instructions, avatarShape: 'heart', avatarColor: 'orange', mode: 'personal' });
      const st = useStore.getState();
      st.set({ bots: st.bots.some((b) => b.id === bot.id) ? st.bots : [...st.bots, bot] });
      st.selectBot(bot.id);
      close();
    } catch (e) { setTemplateError((e as Error).message); }
  };
  const [bump, setBump] = useState(0);
  const refresh = useCallback(() => setBump((n) => n + 1), []);

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 200); return () => clearTimeout(t); }, [search]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    const category = view.kind === 'category' ? view.category : '';
    api.apps(debounced, category)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [debounced, view, connectionsVersion, bump]);

  // Connected list (for the header chip and the Connected view): resolve the connected slugs to full entries.
  useEffect(() => {
    if (!data) return;
    const missing = data.connected.filter((s) => !data.apps.some((a) => a.slug === s));
    if (!missing.length) { setConnectedApps(data.apps.filter((a) => a.connected)); return; }
    let alive = true;
    Promise.all(data.connected.map((s) => api.apps(s).then((r) => r.apps.find((a) => a.slug === s)).catch(() => undefined)))
      .then((list) => { if (alive) setConnectedApps(list.filter((a): a is Toolkit => !!a)); });
    return () => { alive = false; };
  }, [data]);

  const apps = data?.apps ?? [];
  const searching = debounced.length > 0;
  const moreCategories = useMemo(() => (data?.categories ?? []).filter((c) => !PILLS.some((p) => p.category === c)), [data?.categories]);
  const activeCategory = view.kind === 'category' ? view.category : null;
  const moreActive = activeCategory !== null && !PILLS.some((p) => p.category === activeCategory);

  let body: React.ReactNode;
  if (error) body = <div className="apps-empty">Couldn’t load apps. {error}</div>;
  else if (!data && loading) body = <div className="apps-empty">Loading apps…</div>;
  else if (view.kind === 'connected') body = connectedApps.length ? <Section title="Connected" apps={connectedApps} onChanged={refresh} /> : <div className="apps-empty">No apps connected yet.</div>;
  else if (searching || view.kind === 'category') {
    body = apps.length ? (
      <Section title={searching ? `Results${activeCategory ? ` in ${pillLabel(activeCategory)}` : ''}` : pillLabel(activeCategory!)} apps={apps} onChanged={refresh} />
    ) : <div className="apps-empty">No apps match “{debounced}”.</div>;
  } else {
    body = (
      <>
        <Section title="Picked for you" apps={apps.filter((a) => !a.custom).slice(0, 6)} onChanged={refresh} />
        {PILLS.map((p) => {
          const list = apps.filter((a) => a.categories.includes(p.category));
          return <Section key={p.category} title={p.label} apps={list.slice(0, 4)} onViewAll={list.length > 2 ? () => setView({ kind: 'category', category: p.category }) : undefined} onChanged={refresh} />;
        })}
        <Section title="Your own" apps={apps.filter((a) => a.custom)} onChanged={refresh} />
        <CustomApp onDone={refresh} />
      </>
    );
  }

  const connectedCount = data?.connected.length ?? 0;

  return (
    <Modal onClose={close} className="apps-modal" label="Connect Apps">
      <button type="button" className="modal__close apps-modal__close" onClick={close} aria-label="Close"><Icon name="close" size={16} opacity={0.68} /></button>
      <div className="apps-modal__head">
        <div className="apps-modal__titlerow">
          <span className="apps-modal__title">Connect Apps</span>
          <button type="button" className={`apps-modal__connected${view.kind === 'connected' ? ' is-active' : ''}`} onClick={() => setView(view.kind === 'connected' ? { kind: 'all' } : { kind: 'connected' })}>
            {connectedApps.length > 0 && (
              <span className="apps-modal__connected-logos">
                {connectedApps.slice(0, 4).map((a) => a.logo ? <img key={a.slug} src={a.logo} alt="" /> : null)}
              </span>
            )}
            <span>{connectedCount} connected</span>
            <Icon name="chev_right" size={12} opacity={0.56} />
          </button>
        </div>
        <div className="apps-modal__controls">
          <div className="apps-modal__searchrow">
            <label className="pill-input">
              <Icon name="search" size={14} opacity={0.56} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search apps and skills" aria-label="Search apps" />
            </label>
            <span className="cat-pill-anchor">
              <button type="button" className="pill-chip" onClick={() => setTemplates(!templates)} aria-expanded={templates}>
                {primary && <BotAvatarFor bot={primary} size={22} />}
                <span>Bot templates</span>
                <Icon name="chev_down" size={10} opacity={0.56} />
              </button>
              {templates && (
                <Menu align="right" onClose={() => setTemplates(false)} items={BOT_TEMPLATES.map((t) => ({ label: t.name, hint: t.label, onSelect: () => addTemplate(t) }))} />
              )}
            </span>
            {templateError && <span className="app-row__error">{templateError}</span>}
          </div>
          <div className="cat-pills">
            <button type="button" className={`cat-pill${view.kind === 'all' ? ' is-active' : ''}`} onClick={() => setView({ kind: 'all' })}>All</button>
            {PILLS.map((p) => (
              <button key={p.category} type="button" className={`cat-pill${activeCategory === p.category ? ' is-active' : ''}`} onClick={() => setView({ kind: 'category', category: p.category })}>{p.label}</button>
            ))}
            <span className="cat-pill-anchor">
              <button type="button" className={`cat-pill${moreActive ? ' is-active' : ''}`} onClick={() => setMore(!more)} aria-expanded={more}>
                {moreActive ? pillLabel(activeCategory!) : 'More'}
                <Icon name="chev_down" size={10} opacity={0.66} />
              </button>
              {more && (
                <Menu onClose={() => setMore(false)} items={moreCategories.map((c) => ({ label: titleCase(c), onSelect: () => setView({ kind: 'category', category: c }) }))} />
              )}
            </span>
          </div>
        </div>
      </div>
      <div className={`apps-modal__body${loading ? ' is-loading' : ''}`}>{body}</div>
    </Modal>
  );
}
