import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Toolkit } from '@shared/types';
import { BotAvatarFor } from '../../avatar/BotAvatar';
import { configApi, type AuditEntry, type ComputerDetails, type PhoneInfo, type WhatsAppInfo } from '../../lib/configApi';
import { relativeShort } from '../../lib/time';
import { useConfigUI, type AppSection, type Theme } from '../../configStore';
import { useStore } from '../../store';
import { computerStatusText } from '../DetailsPanel';
import { Icon } from '../Icon';
import { ToolkitLogo } from '../ToolkitLogo';
import { Glyph } from './glyphs';
import { ConfirmButton } from './ui';

const SECTIONS: { id: AppSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'computer', label: 'Computer' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'apps', label: 'Connected apps' },
  { id: 'phone', label: 'Phone' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'activity', label: 'Activity log' },
  { id: 'account', label: 'Account' },
];

/** Full-window settings page, opened from the account menu. */
export function AppSettings() {
  const section = useConfigUI((s) => s.appSettings);
  const close = useConfigUI((s) => s.closeAppSettings);
  const open = useConfigUI((s) => s.openAppSettings);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.modal-root')) { e.preventDefault(); close(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [close]);
  if (!section) return null;
  return createPortal(
    <div className="app-settings" role="dialog" aria-modal="true" aria-label="Settings">
      <aside className="app-settings__nav">
        <button type="button" className="app-settings__back" onClick={close}><Glyph name="arrow_left" size={14} /> Back to Bots</button>
        <div className="app-settings__heading">Settings</div>
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className={`cfg-nav__item${section === s.id ? ' is-active' : ''}`} onClick={() => open(s.id)} aria-current={section === s.id || undefined}>
            {s.label}
          </button>
        ))}
      </aside>
      <div className="app-settings__main">
        <button type="button" className="app-settings__close icon-btn" onClick={close} aria-label="Close settings" title="Close (Esc)"><Icon name="close" opacity={0.8} /></button>
        <div className="app-settings__page">
          {section === 'general' && <GeneralSection />}
          {section === 'computer' && <ComputerSection />}
          {section === 'permissions' && <PermissionsSection />}
          {section === 'apps' && <AppsSection />}
          {section === 'phone' && <PhoneSection />}
          {section === 'whatsapp' && <WhatsAppSection />}
          {section === 'activity' && <ActivitySection />}
          {section === 'account' && <AccountSection />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PageHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="app-settings__head">
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ThemeTile({ value, label, current, onPick }: { value: Theme; label: string; current: Theme; onPick: (t: Theme) => void }) {
  return (
    <button type="button" role="radio" aria-checked={current === value} className={`theme-tile${current === value ? ' is-active' : ''}`} onClick={() => onPick(value)}>
      <span className={`theme-tile__art is-${value}`} aria-hidden>
        <span className="theme-tile__side" />
        <span className="theme-tile__pane"><i /><i /><b /></span>
      </span>
      <span className="theme-tile__label">{label}</span>
    </button>
  );
}

function GeneralSection() {
  const theme = useConfigUI((s) => s.theme);
  const setTheme = useConfigUI((s) => s.setTheme);
  return (
    <>
      <PageHead title="General" />
      <section className="cfg-section">
        <div className="cfg-section__label">Theme</div>
        <div className="theme-tiles" role="radiogroup" aria-label="Theme">
          <ThemeTile value="system" label="System" current={theme} onPick={setTheme} />
          <ThemeTile value="light" label="Light" current={theme} onPick={setTheme} />
          <ThemeTile value="dark" label="Dark" current={theme} onPick={setTheme} />
        </div>
        <div className="cfg-field__hint">System follows your device’s light or dark setting.</div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

const screenLabel = (id: string) => (id === 'default' ? 'Main screen' : `Screen ${Number(id.replace('screen-', '')) - 98 || id}`);

function ComputerSection() {
  const computer = useStore((s) => s.computer);
  const bots = useStore((s) => s.bots);
  const [details, setDetails] = useState<ComputerDetails | null>(null);
  const [busy, setBusy] = useState<'wake' | 'sleep' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => { configApi.computerDetails().then(setDetails).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load, computer?.status, computer?.screens.length]);

  const status = computer?.status ?? details?.computer.status;
  const running = status === 'running';
  const transitioning = status === 'starting' || status === 'resuming' || status === 'creating' || status === 'suspending';
  const act = async (kind: 'wake' | 'sleep') => {
    setBusy(kind); setNote(null);
    try { kind === 'wake' ? await configApi.wake() : await configApi.sleep(); }
    catch (e) { setNote((e as Error).message); }
    finally { setBusy(null); }
  };
  const byId = new Map(bots.map((b) => [b.id, b]));
  // The server says how many screens the computer can hold; 4 until it does.
  const maxScreens = computer?.maxScreens ?? details?.computer.maxScreens ?? 4;

  return (
    <>
      <PageHead title="Computer" sub="Your Bots share one cloud computer. Each Bot works on its own screen." />
      <section className="cfg-section">
        <div className="cfg-card">
          <div className="cfg-row">
            <span className={`computer-status-dot is-${running ? 'on' : transitioning ? 'busy' : 'off'}`} aria-hidden />
            <div className="cfg-row__text">
              <div className="cfg-row__title">Bots’ computer · {computerStatusText(computer ?? null)}</div>
              <div className="cfg-row__sub">
                {details ? `Goes to sleep after ${details.hibernation.idleMinutes} idle minutes when nobody is watching. Starts again on its own once a Bot has work.` : 'Checking…'}
              </div>
            </div>
            {running || status === 'suspending' ? (
              <button type="button" className="cfg-btn cfg-btn--secondary" disabled={!running || !!busy} onClick={() => act('sleep')}>{busy === 'sleep' || status === 'suspending' ? 'Going to sleep…' : 'Sleep'}</button>
            ) : (
              <button type="button" className="cfg-btn cfg-btn--primary" disabled={transitioning || !!busy} onClick={() => act('wake')}>{busy === 'wake' || transitioning ? 'Waking…' : 'Wake'}</button>
            )}
          </div>
          {computer?.error && status === 'error' && <div className="cfg-error cfg-error--inset">{computer.error}</div>}
          {note && <div className="cfg-error cfg-error--inset">{note}</div>}
        </div>
      </section>

      <section className="cfg-section">
        <div className="cfg-section__label">Screens in use{details && maxScreens ? ` · ${details.screens.length} of ${maxScreens}` : ''}</div>
        <div className="cfg-card">
          {!details ? <div className="cfg-empty cfg-empty--flat">Loading…</div> : details.screens.length === 0 ? (
            <div className="cfg-empty cfg-empty--flat">No Bot has used the computer yet.</div>
          ) : details.screens.map((s) => {
            const bot = byId.get(s.botId);
            return (
              <div key={s.botId} className="cfg-row">
                {bot ? <BotAvatarFor bot={bot} size={28} /> : <span className="cfg-row__ph" />}
                <div className="cfg-row__text">
                  <div className="cfg-row__title">{bot?.name ?? 'Removed Bot'}</div>
                  <div className="cfg-row__sub">{screenLabel(s.screenId)} · used {relativeShort(s.lastUsedAt) === 'now' ? 'just now' : `${relativeShort(s.lastUsedAt)}${/^\d/.test(relativeShort(s.lastUsedAt)) ? ' ago' : ''}`}</div>
                </div>
                <ConfirmButton
                  className="cfg-btn cfg-btn--secondary"
                  confirmLabel="Reset screen"
                  disabled={!running}
                  title={running ? 'Closes everything open on this screen' : 'Wake the computer first'}
                  onConfirm={async () => { try { await configApi.resetScreen(s.botId); setNote(null); load(); } catch (e) { setNote((e as Error).message); } }}
                >
                  Reset
                </ConfirmButton>
              </div>
            );
          })}
        </div>
        <div className="cfg-field__hint">Reset closes every window on that Bot’s screen, so it starts clean next time.{maxScreens ? ` Up to ${maxScreens} Bots can have a screen at once${details && details.screens.length >= maxScreens ? '; reset one to free it for another Bot' : ''}.` : ''}</div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function humanizeTool(slug: string): { app: string; action: string } {
  const parts = slug.split(/[_:]/).filter(Boolean);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  if (parts.length < 2) return { app: cap(slug), action: '' };
  return { app: cap(parts[0]), action: cap(parts.slice(1).join(' ')) };
}

function ActivitySection() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  useEffect(() => { configApi.audit().then((r) => setRows(r.entries)).catch(() => setRows([])); }, []);
  return (
    <>
      <PageHead title="Activity log" sub="Every action your Bots ran on this computer. Kept only here, with keys hidden." />
      <section className="cfg-section">
        <div className="cfg-card">
          {rows === null ? <div className="cfg-empty cfg-empty--flat">Loading…</div> : rows.length === 0 ? (
            <div className="cfg-empty cfg-empty--flat">Nothing yet.</div>
          ) : rows.map((r, i) => (
            <div key={i} className="cfg-row">
              <div className="cfg-row__text">
                <div className="cfg-row__title">{r.tool}{r.danger ? ` · careful: ${r.danger}` : ''}</div>
                <div className="cfg-row__sub">{new Date(r.t).toLocaleString()} · {r.status}{r.args && r.args !== '{}' ? ` · ${r.args.slice(0, 120)}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function PermissionsSection() {
  const [policies, setPolicies] = useState<{ tool: string; mode: string }[] | null>(null);
  const load = useCallback(() => { configApi.policies().then((r) => setPolicies(r.policies)).catch(() => setPolicies([])); }, []);
  useEffect(() => { load(); }, [load]);
  const [mode, setMode] = useState<'ask' | 'follow'>('ask');
  useEffect(() => { configApi.dangerMode().then((r) => setMode(r.mode)).catch(() => {}); }, []);
  const pick = (m: 'ask' | 'follow') => { setMode(m); configApi.setDangerMode(m).catch(() => configApi.dangerMode().then((r) => setMode(r.mode)).catch(() => {})); };
  return (
    <>
      <PageHead title="Permissions" sub="Actions your Bots can take without asking first. Remove one and they’ll ask again next time." />
      <section className="cfg-section">
        <div className="cfg-section__label">Risky actions (delete everything, run downloaded scripts, force-push…)</div>
        <div className="cfg-card">
          <div className="cfg-row">
            <div className="cfg-row__text">
              <div className="cfg-row__title">{mode === 'ask' ? 'Always ask me' : 'Follow “Always allow”'}</div>
              <div className="cfg-row__sub">{mode === 'ask' ? 'Risky actions ask every time, even if you chose “Always allow”.' : 'Risky actions run without asking if you chose “Always allow” for that tool.'}</div>
            </div>
            <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => pick(mode === 'ask' ? 'follow' : 'ask')}>{mode === 'ask' ? 'Follow “Always allow”' : 'Always ask me'}</button>
          </div>
        </div>
      </section>
      <section className="cfg-section">
        <div className="cfg-card">
          {policies === null ? <div className="cfg-empty cfg-empty--flat">Loading…</div> : policies.length === 0 ? (
            <div className="cfg-empty cfg-empty--flat">Nothing here yet. When you choose “Always allow” on an approval, it shows up here.</div>
          ) : policies.map((p) => {
            const h = humanizeTool(p.tool);
            return (
              <div key={p.tool} className="cfg-row">
                <div className="cfg-row__text">
                  <div className="cfg-row__title">{h.app}{h.action ? ` · ${h.action}` : ''}</div>
                  <div className="cfg-row__sub">{p.mode === 'always_allow' ? 'Always allowed' : p.mode === 'blocked' ? 'Never allowed' : 'Asks first'} · <code className="cfg-code">{p.tool}</code></div>
                </div>
                <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => configApi.deletePolicy(p.tool).then(load).catch(() => {})}>Ask again</button>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function AppsSection() {
  const version = useStore((s) => s.connectionsVersion);
  const [apps, setApps] = useState<Toolkit[] | null>(null);
  useEffect(() => { configApi.connectedApps().then((r) => setApps(r.connectedApps ?? [])).catch(() => setApps([])); }, [version]);
  const openApps = () => { useConfigUI.getState().closeAppSettings(); useStore.getState().setModal('apps'); };
  return (
    <>
      <PageHead title="Connected apps" sub="Apps your Bots can use for you, like email, calendar and docs." />
      <section className="cfg-section">
        <div className="cfg-card">
          <div className="cfg-row">
            <div className="cfg-row__text">
              <div className="cfg-row__title">{apps === null ? 'Checking…' : apps.length ? `${apps.length} app${apps.length === 1 ? '' : 's'} connected` : 'No apps connected yet'}</div>
              <div className="cfg-row__sub">Bots ask before doing anything that changes data in an app.</div>
            </div>
            <button type="button" className="cfg-btn cfg-btn--primary" onClick={openApps}>{apps?.length ? 'Manage apps' : 'Connect apps'}</button>
          </div>
          {apps?.map((a) => (
            <div key={a.slug} className="cfg-row">
              <ToolkitLogo name={a.name} logo={a.logo} size={28} radius={7} />
              <div className="cfg-row__text">
                <div className="cfg-row__title">{a.name}</div>
                {a.description && <div className="cfg-row__sub">{a.description}</div>}
              </div>
              <span className="cfg-chip">Connected</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function AccountSection() {
  const user = useStore((s) => s.user);
  const [busy, setBusy] = useState(false);
  const initials = (user?.name ?? user?.email ?? '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <>
      <PageHead title="Account" />
      <section className="cfg-section">
        <div className="cfg-card">
          <div className="cfg-row">
            <span className="account__initials">{initials}</span>
            <div className="cfg-row__text">
              <div className="cfg-row__title">{user?.name}</div>
              <div className="cfg-row__sub">{user?.email}</div>
            </div>
            <button type="button" className="cfg-btn cfg-btn--secondary" disabled={busy} onClick={async () => { setBusy(true); await configApi.logout().catch(() => {}); location.reload(); }}>
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function PhoneSection() {
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [pair, setPair] = useState<{ url: string; qr: string; via: 'lan' | 'tunnel' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { configApi.phone().then(setInfo).catch((e) => setError((e as Error).message)); }, []);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setError(null);
    try { await fn(); load(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const startPair = (via: 'lan' | 'tunnel') => run(`pair-${via}`, async () => { const r = await configApi.phonePair(via); setPair({ ...r, via }); });
  // The code is used once and then gone: leave the QR view as soon as a new phone shows up.
  const count = info?.devices.length ?? 0;
  useEffect(() => { setPair(null); }, [count]);
  return (
    <>
      <PageHead title="Phone" sub="Control Krishbot on this laptop from your phone. The laptop does the work; keep Krishbot open on it." />
      <section className="cfg-section">
        <div className="cfg-card">
          <div className="cfg-row">
            <div className="cfg-row__text">
              <div className="cfg-row__title">Pair a phone on your home Wi-Fi</div>
              <div className="cfg-row__sub">{info?.lan.length ? `Phone and laptop must be on the same Wi-Fi (${info.lan[0].url}).` : 'No home network found. Connect this laptop to Wi-Fi.'}</div>
            </div>
            <button type="button" className="cfg-btn cfg-btn--primary" disabled={!info?.lan.length || !!busy} onClick={() => startPair('lan')}>Show QR code</button>
          </div>
          <div className="cfg-row">
            <div className="cfg-row__text">
              <div className="cfg-row__title">Away from home (free tunnel)</div>
              <div className="cfg-row__sub">{info?.tunnel.on ? info.tunnel.url : 'Uses a free Cloudflare quick tunnel, no account. Needs cloudflared installed. The address changes each time.'}</div>
            </div>
            {info?.tunnel.on ? (
              <>
                <button type="button" className="cfg-btn cfg-btn--primary" disabled={!!busy} onClick={() => startPair('tunnel')}>Show QR code</button>
                <button type="button" className="cfg-btn cfg-btn--secondary" disabled={!!busy} onClick={() => run('off', async () => { await configApi.phoneTunnel(false); setPair(null); })}>Turn off</button>
              </>
            ) : (
              <button type="button" className="cfg-btn cfg-btn--secondary" disabled={!!busy} onClick={() => run('on', async () => { await configApi.phoneTunnel(true); })}>{busy === 'on' ? 'Starting…' : 'Turn on'}</button>
            )}
          </div>
          {pair && (
            <div className="cfg-row phone-qr">
              <img src={pair.qr} alt="Pairing QR code" width={180} height={180} />
              <div className="cfg-row__text">
                <div className="cfg-row__title">Scan with your phone's camera</div>
                <div className="cfg-row__sub">Works once, for 5 minutes. On the phone, use “Add to Home screen” to install it like an app.</div>
              </div>
            </div>
          )}
          {error && <div className="card__error" style={{ margin: '0 16px 12px' }}>{error}</div>}
        </div>
      </section>
      <section className="cfg-section">
        <div className="cfg-section__label">Paired phones</div>
        <div className="cfg-card">
          {!info?.devices.length && <div className="cfg-row"><div className="cfg-row__sub">No phones paired yet.</div></div>}
          {info?.devices.map((d) => (
            <div key={d.id} className="cfg-row">
              <div className="cfg-row__text">
                <div className="cfg-row__title">{d.name}</div>
                <div className="cfg-row__sub">Paired {relativeShort(d.pairedAt)}{d.lastSeen ? ` · last seen ${relativeShort(d.lastSeen)}` : ''}</div>
              </div>
              <button type="button" className="cfg-btn cfg-btn--secondary" disabled={!!busy} onClick={() => run('rm', async () => { await configApi.phoneRemove(d.id); })}>Remove</button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function WhatsAppSection() {
  const [info, setInfo] = useState<WhatsAppInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [numbers, setNumbers] = useState('');
  const load = useCallback(() => { configApi.whatsapp().then((i) => { setInfo(i); setNumbers((n) => n || i.allow.join(', ')); }).catch((e) => setError((e as Error).message)); }, []);
  useEffect(() => { load(); const t = setInterval(load, 2500); return () => clearInterval(t); }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const on = info && info.status !== 'off';
  const label = { off: 'Not connected', starting: 'Connecting…', qr: 'Waiting for you to scan', connected: `Connected${info?.me ? ` as +${info.me}` : ''}`, error: 'Problem' }[info?.status ?? 'off'];
  return (
    <>
      <PageHead title="WhatsApp" sub="Talk to your main Bot from WhatsApp. It runs on this computer; nothing goes through our servers." />
      <section className="cfg-section">
        <div className="cfg-card">
          <div className="cfg-row">
            <span className={`computer-status-dot is-${info?.status === 'connected' ? 'on' : on ? 'busy' : 'off'}`} aria-hidden />
            <div className="cfg-row__text">
              <div className="cfg-row__title">{label}</div>
              <div className="cfg-row__sub">{info?.error ?? (info?.status === 'connected' ? 'Message yourself on WhatsApp to give the Bot a task. Replies and approval questions come back there.' : 'Links like WhatsApp Web, with a QR code.')}</div>
            </div>
            {!on && <button type="button" className="cfg-btn cfg-btn--primary" disabled={busy} onClick={() => run(configApi.whatsappStart)}>Connect</button>}
            {on && <button type="button" className="cfg-btn cfg-btn--secondary" disabled={busy} onClick={() => run(configApi.whatsappStop)}>Turn off</button>}
          </div>
          {info?.qr && (
            <div className="cfg-row phone-qr">
              <img src={info.qr} alt="WhatsApp QR code" width={200} height={200} />
              <div className="cfg-row__text">
                <div className="cfg-row__title">Scan with WhatsApp</div>
                <div className="cfg-row__sub">On your phone: WhatsApp → Settings → Linked devices → Link a device.</div>
              </div>
            </div>
          )}
          {error && <div className="card__error" style={{ margin: '0 16px 12px' }}>{error}</div>}
        </div>
      </section>
      <section className="cfg-section">
        <div className="cfg-section__label">Other numbers allowed to command the Bot</div>
        <div className="cfg-card">
          <div className="cfg-row">
            <input className="text-input" style={{ flex: 1 }} placeholder="+91 98765 43210, +1 555 0100" value={numbers} onChange={(e) => setNumbers(e.target.value)} aria-label="Allowed numbers" />
            <button type="button" className="cfg-btn cfg-btn--secondary" disabled={busy} onClick={() => run(() => configApi.whatsappAllow(numbers.split(/[,\n]/).map((n) => n.trim()).filter(Boolean)))}>Save</button>
          </div>
          <div className="cfg-row"><div className="cfg-row__sub">Your own “Message yourself” chat always works. Anyone you add here can make the Bot act on this computer, so add only people you trust.</div></div>
        </div>
      </section>
      {info?.status === 'connected' && (
        <section className="cfg-section">
          <div className="cfg-card">
            <div className="cfg-row">
              <div className="cfg-row__text"><div className="cfg-row__title">Unlink this computer</div><div className="cfg-row__sub">Removes the saved WhatsApp login from this computer.</div></div>
              <ConfirmButton confirmLabel="Really unlink?" onConfirm={() => run(configApi.whatsappUnlink)}>Unlink</ConfirmButton>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
