import { PALETTES } from '../../lib/palettes';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Toolkit } from '@shared/types';
import { BotAvatarFor } from '../../avatar/BotAvatar';
import { configApi, type AuditEntry, type Flow, type TelegramInfo, type LibrarySkill, type Issue, type IssueStatus, type Goal, type ProjectInfo, type VaultItem, type GoalLevel, type GoalStatus, type FlowRun, type FlowStep, type ComputerDetails, type PhoneInfo, type WhatsAppInfo, type DangerMode } from '../../lib/configApi';
import { relativeShort } from '../../lib/time';
import { useConfigUI, type AppSection, type Theme } from '../../configStore';
import { useStore } from '../../store';
import { computerStatusText } from '../DetailsPanel';
import { Icon } from '../Icon';
import { ToolkitLogo } from '../ToolkitLogo';
import { Glyph } from './glyphs';
import { ConfirmButton } from './ui';
import { ModelsSection } from './ModelsSection';

const SECTIONS: { id: AppSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'models', label: 'Models' },
  { id: 'computer', label: 'Computer' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'apps', label: 'Connected apps' },
  { id: 'phone', label: 'Phone' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'projects', label: 'Companies' },
  { id: 'vault', label: 'Vault' },
  { id: 'goals', label: 'Goals' },
  { id: 'issues', label: 'Issues' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'skills', label: 'Skills' },
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
          {section === 'models' && <ModelsSection />}
          {section === 'computer' && <ComputerSection />}
          {section === 'permissions' && <PermissionsSection />}
          {section === 'apps' && <AppsSection />}
          {section === 'phone' && <PhoneSection />}
          {section === 'whatsapp' && <WhatsAppSection />}
          {section === 'telegram' && <TelegramSection />}
          {section === 'projects' && <ProjectsSection />}
          {section === 'vault' && <VaultSection />}
          {section === 'goals' && <GoalsSection />}
          {section === 'issues' && <IssuesSection />}
          {section === 'skills' && <SkillsSection />}
          {section === 'workflows' && <WorkflowsSection />}
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
  const palette = useConfigUI((s) => s.palette);
  const setPalette = useConfigUI((s) => s.setPalette);
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
        <div className="cfg-section__label" style={{ marginTop: 16 }}>Colours</div>
        <div className="theme-tiles" role="radiogroup" aria-label="Colours">
          <button type="button" role="radio" aria-checked={!palette} className={`cfg-btn ${!palette ? 'cfg-btn--secondary' : 'cfg-btn--ghost'}`} onClick={() => setPalette(null)}>Default</button>
          {PALETTES.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={palette === p.id} className={`cfg-btn ${palette === p.id ? 'cfg-btn--secondary' : 'cfg-btn--ghost'}`} onClick={() => setPalette(p.id)}>
              <span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, marginRight: 6, background: p.vars['--color-primary'] }} />{p.name}
            </button>
          ))}
        </div>
      </section>
      <UpdateSection />
    </>
  );
}

type Desktop = { version: () => Promise<string>; checkForUpdate: () => Promise<{ status: string; version?: string; error?: string }> };
const desktop = (): Desktop | undefined => (window as unknown as { krishDesktop?: Desktop }).krishDesktop;
const UPDATE_TEXT: Record<string, string> = { current: 'You have the latest version.', later: 'Update postponed.', ready: 'Update downloaded. Restart to finish.', downloaded: 'New version downloaded and opened.', busy: 'Already checking…', dev: 'Updates only work in the installed app.' };

/** Desktop app only: update in place, no trip to the release page. */
function UpdateSection() {
  const d = desktop();
  const [ver, setVer] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { d?.version().then(setVer).catch(() => {}); }, [d]);
  if (!d) return null;
  const check = async () => {
    setBusy(true); setMsg('');
    try { const r = await d.checkForUpdate(); setMsg(r.status === 'error' ? `Could not check: ${r.error}` : UPDATE_TEXT[r.status] ?? r.status); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="cfg-section">
      <div className="cfg-section__label">Updates</div>
      <div className="cfg-card">
        <div className="cfg-row">
          <div className="cfg-row__text">
            <div className="cfg-row__title">OpenKrishBot {ver}</div>
            <div className="cfg-row__sub">{msg || 'Checked automatically when the app starts. Your bots and chats stay as they are.'}</div>
          </div>
          <button type="button" className="cfg-btn cfg-btn--secondary" disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check for updates'}</button>
        </div>
      </div>
    </section>
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
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof configApi.usage>>['usage']>([]);
  useEffect(() => { configApi.audit().then((r) => setRows(r.entries)).catch(() => setRows([])); configApi.usage().then((r) => setUsage(r.usage)).catch(() => {}); }, []);
  const total = usage.reduce((n, u) => n + u.costUsd, 0);
  return (
    <>
      <PageHead title="Activity log" sub="Every action your Bots ran on this computer. Kept only here, with keys hidden." />
      {usage.length > 0 && (
        <section className="cfg-section">
          <div className="cfg-card">
            <div className="cfg-row"><div className="cfg-row__text"><div className="cfg-row__title">Last 7 days{total > 0 ? ` · ≈ $${total.toFixed(total < 0.01 ? 4 : 2)}` : ''}</div></div></div>
            {usage.map((u) => (
              <div key={u.botId} className="cfg-row">
                <div className="cfg-row__text">
                  <div className="cfg-row__title">{u.name}</div>
                  <div className="cfg-row__sub">{(u.tokensIn + u.tokensOut).toLocaleString()} tokens · {u.calls} calls{u.costUsd > 0 ? ` · ≈ $${u.costUsd.toFixed(u.costUsd < 0.01 ? 4 : 2)}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
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
  const [mode, setMode] = useState<DangerMode>('ask');
  useEffect(() => { configApi.dangerMode().then((r) => setMode(r.mode)).catch(() => {}); }, []);
  const pick = (m: DangerMode) => { setMode(m); configApi.setDangerMode(m).catch(() => configApi.dangerMode().then((r) => setMode(r.mode)).catch(() => {})); };
  return (
    <>
      <PageHead title="Permissions" sub="Actions your Bots can take without asking first. Remove one and they’ll ask again next time." />
      <section className="cfg-section">
        <div className="cfg-section__label">How much your Bots ask</div>
        <div className="cfg-card">
          {([
            ['ask', 'Always ask me', 'Risky actions ask every time, even if you chose “Always allow”.'],
            ['follow', 'Follow “Always allow”', 'Risky actions run without asking if you chose “Always allow” for that tool.'],
            ['auto', 'Always autonomous', 'Bots do everything without asking. Only payments and deleting system files still ask each time.'],
          ] as [DangerMode, string, string][]).map(([m, title, sub]) => (
            <div key={m} className="cfg-row">
              <div className="cfg-row__text">
                <div className="cfg-row__title">{title}{mode === m ? ' ✓' : ''}</div>
                <div className="cfg-row__sub">{sub}</div>
              </div>
              <button type="button" className="cfg-btn cfg-btn--secondary" disabled={mode === m} onClick={() => pick(m)}>{mode === m ? 'On' : 'Use'}</button>
            </div>
          ))}
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
      <PageHead title="Phone" sub="Control OpenKrishBot on this laptop from your phone. The laptop does the work; keep OpenKrishBot open on it." />
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

const blankStep = (n: number): FlowStep => ({ id: `step${n}`, bot: '', prompt: '', needs: [], retries: 0 });

function WorkflowsSection() {
  const bots = useStore((s) => s.bots).filter((b) => b.kind !== 'room');
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [edit, setEdit] = useState<{ id?: string; name: string; steps: FlowStep[]; schedule?: string } | null>(null);
  const [err, setErr] = useState('');
  const [run, setRun] = useState<FlowRun | null>(null);
  const [input, setInput] = useState('');
  const [goal, setGoal] = useState('');
  const [planning, setPlanning] = useState(false);
  const load = useCallback(() => configApi.flows().then((r) => setFlows(r.flows)).catch(() => setFlows([])), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!run || run.status !== 'running') return;
    const t = setInterval(() => configApi.flowRun(run.id).then((r) => setRun(r.run)).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [run]);

  const patch = (i: number, p: Partial<FlowStep>) => setEdit((e) => e && { ...e, steps: e.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const save = async () => {
    if (!edit) return;
    try { await configApi.saveFlow(edit); setEdit(null); setErr(''); load(); } catch (e: any) { setErr(e.message); }
  };
  const plan = async () => {
    setErr(''); setPlanning(true);
    try { const r = await configApi.planFlow(goal); setEdit((e) => e && { ...e, name: e.name || goal.slice(0, 40), steps: r.steps }); } catch (e: any) { setErr(e.message); } finally { setPlanning(false); }
  };
  const start = async (f: Flow) => {
    setErr('');
    try { const { runId } = await configApi.runFlow(f.id, input); setRun((await configApi.flowRun(runId)).run); } catch (e: any) { setErr(e.message); }
  };

  if (edit) {
    return (
      <>
        <PageHead title={edit.id ? 'Edit workflow' : 'New workflow'} sub="Each step is given to one Bot. Steps that don't wait on each other run at the same time. Use {{input}} for what you type when running, and {{step_id}} for an earlier step's answer." />
        <section className="cfg-section">
          <div className="cfg-card" style={{ padding: 12, display: 'grid', gap: 8 }}>
            <input className="text-input" placeholder="Workflow name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <input className="text-input" placeholder="Run automatically (cron, optional) e.g. 0 9 * * 1-5" value={edit.schedule ?? ''} onChange={(e) => setEdit({ ...edit, schedule: e.target.value })} />
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="text-input" placeholder="Plan with AI: write a goal" value={goal} onChange={(e) => setGoal(e.target.value)} />
              <button type="button" className="cfg-btn cfg-btn--secondary" disabled={planning || !goal.trim()} onClick={plan}>{planning ? 'Planning…' : 'Plan with AI'}</button>
            </div>
            {edit.steps.map((s, i) => (
              <div key={i} style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--border, #ddd)', borderRadius: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="text-input" style={{ width: 110 }} placeholder="id" value={s.id} onChange={(e) => patch(i, { id: e.target.value })} />
                  <select className="text-input" value={s.bot} onChange={(e) => patch(i, { bot: e.target.value })}>
                    <option value="">Choose a Bot…</option>
                    {bots.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                  </select>
                  <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_, j) => j !== i).map((x) => ({ ...x, needs: (x.needs ?? []).filter((n) => n !== s.id) })) })}>Remove</button>
                </div>
                <textarea className="text-input" rows={2} placeholder="What should this Bot do?" value={s.prompt} onChange={(e) => patch(i, { prompt: e.target.value })} />
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
                  <span>Waits for:</span>
                  {edit.steps.filter((_, j) => j !== i).map((o) => (
                    <label key={o.id}><input type="checkbox" checked={(s.needs ?? []).includes(o.id)} onChange={(e) => patch(i, { needs: e.target.checked ? [...(s.needs ?? []), o.id] : (s.needs ?? []).filter((n) => n !== o.id) })} /> {o.id}</label>
                  ))}
                  <label><input type="checkbox" checked={!!s.gate} onChange={(e) => patch(i, { gate: e.target.checked })} /> Ask me first</label>
                  <label style={{ marginLeft: 'auto' }}>Retries <select value={s.retries ?? 0} onChange={(e) => patch(i, { retries: Number(e.target.value) })}>{[0, 1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select></label>
                </div>
              </div>
            ))}
            <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => setEdit({ ...edit, steps: [...edit.steps, blankStep(edit.steps.length + 1)] })}><Icon name="plus" size={12} /> Add step</button>
            {err && <div className="cfg-row__sub" style={{ color: 'crimson' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => { setEdit(null); setErr(''); }}>Cancel</button>
              <button type="button" className="cfg-btn cfg-btn--primary" onClick={save}>Save workflow</button>
            </div>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHead title="Workflows" sub="Chain several Bots, or run them side by side. Everything runs on this computer." />
      <section className="cfg-section">
        <div className="cfg-card">
          <div className="cfg-row"><input className="text-input" placeholder="Input for the next run (optional)" value={input} onChange={(e) => setInput(e.target.value)} /></div>
          {flows === null ? <div className="cfg-empty cfg-empty--flat">Loading…</div> : flows.length === 0 ? <div className="cfg-empty cfg-empty--flat">No workflows yet.</div> : flows.map((f) => (
            <div key={f.id} className="cfg-row">
              <div className="cfg-row__text">
                <div className="cfg-row__title">{f.name}</div>
                <div className="cfg-row__sub">{f.steps.length} step{f.steps.length === 1 ? '' : 's'} · {[...new Set(f.steps.map((s) => s.bot))].join(', ')}{f.schedule ? ` · cron ${f.schedule}` : ''}</div>
              </div>
              <button type="button" className="cfg-btn cfg-btn--primary" onClick={() => start(f)}>Run</button>
              <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => setEdit({ id: f.id, name: f.name, steps: f.steps, schedule: f.schedule })}>Edit</button>
              <ConfirmButton className="cfg-btn cfg-btn--secondary" confirmLabel="Delete" onConfirm={async () => { await configApi.deleteFlow(f.id); load(); }}>Delete</ConfirmButton>
            </div>
          ))}
        </div>
        <button type="button" className="cfg-btn cfg-btn--primary" style={{ marginTop: 10 }} onClick={() => setEdit({ name: '', steps: [blankStep(1)] })}><Icon name="plus" size={12} /> New workflow</button>
        {err && <div className="cfg-row__sub" style={{ color: 'crimson' }}>{err}</div>}
      </section>
      {run && (
        <section className="cfg-section">
          <div className="cfg-section__label">Run · {run.status}{run.status === 'running' && <> · <button type="button" className="cfg-link" onClick={() => configApi.stopFlowRun(run.id)}>Stop</button></>}{(run.status === 'failed' || run.status === 'stopped') && <> · <button type="button" className="cfg-link" onClick={async () => { try { const { runId } = await configApi.resumeFlowRun(run.id); setRun((await configApi.flowRun(runId)).run); setErr(''); } catch (e: any) { setErr(e.message); } }}>Continue (keeps finished steps)</button></>}</div>
          <div className="cfg-card">
            {Object.entries(run.results).map(([id, r]) => (
              <div key={id} className="cfg-row">
                <div className="cfg-row__text">
                  <div className="cfg-row__title">{id} · {r.status}{r.attempts > 1 ? ` (try ${r.attempts})` : ''}</div>
                  <div className="cfg-row__sub" style={{ whiteSpace: 'pre-wrap' }}>{r.error ?? (r.output ?? '').slice(0, 600)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const ISSUE_LABEL: Record<IssueStatus, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled' };

const GOAL_STATUS_LABEL: Record<GoalStatus, string> = { planned: 'Planned', active: 'Active', achieved: 'Achieved', cancelled: 'Cancelled' };
const GOAL_LEVEL_LABEL: Record<GoalLevel, string> = { mission: 'Mission', project: 'Project', task: 'Task' };

function GoalsSection() {
  const bots = useStore((s) => s.bots).filter((b) => b.kind !== 'room');
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [title, setTitle] = useState('');
  const [parent, setParent] = useState('');
  const [owner, setOwner] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(() => configApi.goals().then((r) => setGoals(r.goals)).catch(() => setGoals([])), []);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  const act = (p: Promise<unknown>) => p.then(() => { setErr(''); load(); }).catch((e) => setErr(e.message));
  const nameOf = (id: string | null) => bots.find((b) => b.id === id)?.name ?? '';
  const add = () => act(configApi.addGoal({ title, parentId: parent || null, ownerBotId: owner || null }).then(() => setTitle('')));

  // depth-first order, so a goal sits right under its parent
  const rows: { g: Goal; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number, seen: Set<string>) => {
    for (const g of goals ?? []) if (g.parentId === parentId && !seen.has(g.id)) { seen.add(g.id); rows.push({ g, depth }); walk(g.id, depth + 1, seen); }
  };
  walk(null, 0, new Set());

  return (
    <>
      <PageHead title="Goals" sub="What your team is working towards. Give a goal to a Bot, tie issues to it, and watch the progress fill as issues are done." />
      <section className="cfg-section">
        <div className="cfg-card" style={{ padding: 12, display: 'grid', gap: 8 }}>
          <input className="text-input" placeholder="A goal, e.g. Launch the website" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="text-input" value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Under goal">
              <option value="">Top level</option>
              {(goals ?? []).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
            <select className="text-input" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
              <option value="">No owner</option>
              {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button type="button" className="cfg-btn cfg-btn--primary" disabled={!title.trim()} onClick={add}>Add</button>
          </div>
          {err && <div className="cfg-row__sub" style={{ color: 'crimson' }}>{err}</div>}
        </div>
      </section>
      <section className="cfg-section">
        <div className="cfg-card">
          {goals === null ? <div className="cfg-empty cfg-empty--flat">Loading…</div> : rows.length === 0 ? <div className="cfg-empty cfg-empty--flat">No goals yet.</div> : rows.map(({ g, depth }) => (
            <div key={g.id} className="cfg-row" style={{ alignItems: 'flex-start', paddingLeft: 12 + depth * 20 }}>
              <div className="cfg-row__text">
                <div className="cfg-row__title">{g.title}</div>
                <div className="cfg-row__sub">
                  {GOAL_LEVEL_LABEL[g.level]}{nameOf(g.ownerBotId) ? ` · ${nameOf(g.ownerBotId)}` : ''} · {g.total ? `${g.done}/${g.total} issues done` : 'no issues yet'}
                </div>
                {g.total > 0 && <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', marginTop: 6, maxWidth: 220 }}><div style={{ width: `${Math.round((g.done / g.total) * 100)}%`, height: '100%', borderRadius: 2, background: 'var(--primary)', transition: 'width .3s' }} /></div>}
              </div>
              <select className="text-input" style={{ width: 110 }} value={g.ownerBotId ?? ''} onChange={(e) => act(configApi.patchGoal(g.id, { ownerBotId: e.target.value || null }))} aria-label="Owner">
                <option value="">No owner</option>
                {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select className="text-input" style={{ width: 110 }} value={g.status} onChange={(e) => act(configApi.patchGoal(g.id, { status: e.target.value as GoalStatus }))} aria-label="Status">
                {(Object.keys(GOAL_STATUS_LABEL) as GoalStatus[]).map((s) => <option key={s} value={s}>{GOAL_STATUS_LABEL[s]}</option>)}
              </select>
              <ConfirmButton className="cfg-btn cfg-btn--secondary" confirmLabel="Delete" onConfirm={() => act(configApi.deleteGoal(g.id))}>Delete</ConfirmButton>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function ProjectsSection() {
  const bots = useStore((s) => s.bots).filter((b) => b.kind !== 'room');
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [name, setName] = useState('');
  const [templates, setTemplates] = useState<{ id: string; name: string; goal: string; bots: string[] }[]>([]);
  useEffect(() => { configApi.companyTemplates().then((r) => setTemplates(r.templates)).catch(() => {}); }, []);
  const [err, setErr] = useState('');
  const load = useCallback(() => configApi.projects().then((r) => setProjects(r.projects)).catch(() => setProjects([])), []);
  useEffect(() => { load(); }, [load]);
  const act = (p: Promise<unknown>) => p.then(() => { setErr(''); load(); }).catch((e) => setErr(e.message));
  const inProject = (id: string) => bots.filter((b) => projects?.find((p) => p.id === id)?.botIds.includes(b.id));
  const projectOf = (botId: string) => projects?.find((p) => p.botIds.includes(botId))?.id ?? '';
  const addFile = (id: string, f: File | undefined) => { if (f) void f.text().then((content) => act(configApi.addProjectFile(id, { name: f.name, content }))); };

  return (
    <>
      <PageHead title="Companies" sub="A company is a group of Bots with shared instructions and files. Your Chief can create one for you by hiring Bots. Export it as a file, import it on another computer." />
      <section className="cfg-section">
        <div className="cfg-card" style={{ padding: 12, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="text-input" placeholder="A company, e.g. Dropship Co" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="cfg-btn cfg-btn--primary" disabled={!name.trim()} onClick={() => act(configApi.addProject({ name }).then(() => setName('')))}>Add</button>
          </div>
          <label className="cfg-row__sub">Import a company file: <input type="file" accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void f.text().then((t) => act(configApi.importCompany(JSON.parse(t)))).catch(() => setErr('That file is not valid JSON.')); }} /></label>
          {templates.length > 0 && <div className="cfg-row__sub">Ready-made companies (hires the whole team):</div>}
          {templates.map((t) => (
            <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="cfg-row__sub"><b>{t.name}</b>: {t.bots.join(', ')}</span>
              <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => act(configApi.addCompanyTemplate(t.id))}>Hire team</button>
            </div>
          ))}
          {err && <div className="cfg-row__sub" style={{ color: 'crimson' }}>{err}</div>}
        </div>
      </section>
      {projects === null ? <div className="cfg-empty cfg-empty--flat">Loading…</div> : projects.length === 0 ? <div className="cfg-empty cfg-empty--flat">No companies yet. Ask your Chief: "Make a company that …".</div> : projects.map((p) => (
        <section className="cfg-section" key={p.id}>
          <div className="cfg-card" style={{ padding: 12, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <b style={{ flex: 1 }}>{p.name}</b>
              <span className="cfg-row__sub">{inProject(p.id).map((b) => b.name).join(', ') || 'No Bots yet'}</span>
              <a className="cfg-btn cfg-btn--secondary" href={`/api/projects/${p.id}/export`} download>Export</a>
              <ConfirmButton className="cfg-btn cfg-btn--secondary" confirmLabel="Delete" onConfirm={() => act(configApi.deleteProject(p.id))}>Delete</ConfirmButton>
            </div>
            <textarea className="text-input" rows={4} placeholder="Instructions every Bot in this project follows" defaultValue={p.instructions} onBlur={(e) => { if (e.target.value !== p.instructions) act(configApi.patchProject(p.id, { instructions: e.target.value })); }} />
            {p.files.map((f) => (
              <div key={f.id} className="cfg-row__sub" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{f.name} · {f.size.toLocaleString()} characters</span>
                <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => act(configApi.deleteProjectFile(p.id, f.id))}>Remove</button>
              </div>
            ))}
            <input type="file" accept=".txt,.md,.csv,.json,.html,.xml,.yaml,.yml,.js,.ts,.py,text/*" onChange={(e) => { addFile(p.id, e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        </section>
      ))}
      {projects && projects.length > 0 && (
        <section className="cfg-section">
          <div className="cfg-card">
            {bots.map((b) => (
              <div key={b.id} className="cfg-row">
                <div className="cfg-row__text"><div className="cfg-row__title">{b.name}</div></div>
                <select className="text-input" style={{ width: 170 }} value={projectOf(b.id)} onChange={(e) => act(configApi.assignProject(b.id, e.target.value || null))} aria-label={`Project for ${b.name}`}>
                  <option value="">No project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function VaultSection() {
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [f, setF] = useState({ name: '', value: '', origin: '', auth: 'bearer', header: '', username: '' });
  const [err, setErr] = useState('');
  const load = useCallback(() => configApi.vault().then((r) => setItems(r.items)).catch(() => setItems([])), []);
  useEffect(() => { load(); }, [load]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const login = f.auth === 'login';
  const save = () => configApi.saveSecret({ ...f, name: f.name.trim() }).then(() => { setErr(''); setF({ name: '', value: '', origin: '', auth: 'bearer', header: '', username: '' }); load(); }).catch((e) => setErr(e.message));
  return (
    <>
      <PageHead title="Vault" sub="Logins and API keys your Bots can use without ever seeing them. Stored encrypted on this computer. Bots see names only; a key is only sent to the site you save it for." />
      <section className="cfg-section">
        <div className="cfg-card" style={{ padding: 12, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="text-input" placeholder="Name, e.g. amazon-login" value={f.name} onChange={set('name')} />
            <select className="text-input" style={{ width: 190 }} value={f.auth} onChange={set('auth')} aria-label="Type">
              <option value="bearer">API key (Bearer)</option><option value="header">API key (header)</option><option value="basic">Basic auth</option><option value="login">Website login</option>
            </select>
          </div>
          {<input className="text-input" placeholder="Site, e.g. https://www.amazon.in" value={f.origin} onChange={set('origin')} />}
          {f.auth === 'header' && <input className="text-input" placeholder="Header name, e.g. X-Api-Key" value={f.header} onChange={set('header')} />}
          {(f.auth === 'basic' || login) && <input className="text-input" placeholder="Username / email" value={f.username} onChange={set('username')} autoComplete="off" />}
          <input className="text-input" type="password" placeholder={login ? 'Password' : 'Key'} value={f.value} onChange={set('value')} autoComplete="new-password" />
          {err && <div className="cfg-row__sub" style={{ color: 'crimson' }}>{err}</div>}
          <div><button type="button" className="cfg-btn cfg-btn--primary" disabled={!f.name.trim() || !f.value} onClick={save}>Save to vault</button></div>
        </div>
      </section>
      {items === null ? <div className="cfg-empty cfg-empty--flat">Loading…</div> : items.length === 0 ? <div className="cfg-empty cfg-empty--flat">Nothing saved yet.</div> : (
        <section className="cfg-section"><div className="cfg-card">
          {items.map((i) => (
            <div key={i.id} className="cfg-row">
              <div className="cfg-row__text"><div className="cfg-row__title">{i.name}</div><div className="cfg-row__sub">{i.auth}{i.origin ? ` · ${i.origin}` : ''}{i.username ? ` · ${i.username}` : ''} · value hidden</div></div>
              <ConfirmButton className="cfg-btn cfg-btn--secondary" confirmLabel="Delete" onConfirm={() => configApi.deleteSecret(i.name).then(load)}>Delete</ConfirmButton>
            </div>
          ))}
        </div></section>
      )}
    </>
  );
}

function IssuesSection() {
  const [goals, setGoals] = useState<Goal[]>([]);
  useEffect(() => { configApi.goals().then((r) => setGoals(r.goals)).catch(() => {}); }, []);
  const bots = useStore((s) => s.bots).filter((b) => b.kind !== 'room');
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [assignee, setAssignee] = useState('');
  const [goalId, setGoalId] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(() => configApi.issues().then((r) => setIssues(r.issues)).catch(() => setIssues([])), []);
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);
  const nameOf = (id: string | null) => bots.find((b) => b.id === id)?.name ?? (id ? 'Unknown bot' : 'Nobody');
  const act = (p: Promise<unknown>) => p.then(() => { setErr(''); load(); }).catch((e) => setErr(e.message));
  const add = () => act(configApi.addIssue({ title, body, assigneeBotId: assignee || null, goalId: goalId || null }).then(() => { setTitle(''); setBody(''); }));

  return (
    <>
      <PageHead title="Issues" sub="Shared work for your Bots. An assigned issue wakes that Bot; it takes the issue, does it, and reports back. Bots can also create and hand off issues to each other." />
      <section className="cfg-section">
        <div className="cfg-card" style={{ padding: 12, display: 'grid', gap: 8 }}>
          <input className="text-input" placeholder="What needs doing?" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="text-input" rows={2} placeholder="Details (optional)" value={body} onChange={(e) => setBody(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="text-input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Unassigned</option>
              {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {goals.length > 0 && (
              <select className="text-input" value={goalId} onChange={(e) => setGoalId(e.target.value)} aria-label="Goal">
                <option value="">No goal</option>
                {goals.filter((g) => g.status === 'active' || g.status === 'planned').map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            )}
            <button type="button" className="cfg-btn cfg-btn--primary" disabled={!title.trim()} onClick={add}>Create</button>
          </div>
          {err && <div className="cfg-row__sub" style={{ color: 'crimson' }}>{err}</div>}
        </div>
      </section>
      <section className="cfg-section">
        <div className="cfg-card">
          {issues === null ? <div className="cfg-empty cfg-empty--flat">Loading…</div> : issues.length === 0 ? <div className="cfg-empty cfg-empty--flat">No issues yet.</div> : issues.map((i) => (
            <div key={i.id} className="cfg-row" style={{ alignItems: 'flex-start' }}>
              <div className="cfg-row__text">
                <div className="cfg-row__title">{i.parentId ? '↳ ' : ''}{i.title}</div>
                <div className="cfg-row__sub" style={{ whiteSpace: 'pre-wrap' }}>
                  {ISSUE_LABEL[i.status]} · {i.checkoutBotId ? `${nameOf(i.checkoutBotId)} is on it` : `Assigned to ${nameOf(i.assigneeBotId)}`}{i.result ? `\n${i.result.slice(0, 500)}` : ''}
                </div>
              </div>
              <select className="text-input" style={{ width: 120 }} value={i.assigneeBotId ?? ''} onChange={(e) => act(configApi.patchIssue(i.id, { assigneeBotId: e.target.value || null }))} aria-label="Assignee">
                <option value="">Unassigned</option>
                {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select className="text-input" style={{ width: 120 }} value={i.status} onChange={(e) => act(configApi.patchIssue(i.id, { status: e.target.value as IssueStatus }))} aria-label="Status">
                {(Object.keys(ISSUE_LABEL) as IssueStatus[]).map((s) => <option key={s} value={s}>{ISSUE_LABEL[s]}</option>)}
              </select>
              {goals.length > 0 && (
                <select className="text-input" style={{ width: 120 }} value={i.goalId ?? ''} onChange={(e) => act(configApi.linkIssue(i.id, e.target.value || null))} aria-label="Goal">
                  <option value="">No goal</option>
                  {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                </select>
              )}
              <ConfirmButton className="cfg-btn cfg-btn--secondary" confirmLabel="Delete" onConfirm={() => act(configApi.deleteIssue(i.id))}>Delete</ConfirmButton>
              <IssueNotes issueId={i.id} nameOf={nameOf} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function SkillsSection() {
  const [skills, setSkills] = useState<LibrarySkill[] | null>(null);
  const [src, setSrc] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(() => configApi.skillLibrary().then((r) => setSkills(r.skills)).catch(() => setSkills([])), []);
  useEffect(() => { load(); }, [load]);
  const add = () => {
    setErr('');
    const t = src.trim();
    configApi.importSkill(/^https?:\/\//.test(t) ? { url: t } : { markdown: t }).then(() => { setSrc(''); load(); }).catch((e) => setErr(e.message));
  };
  const toggle = (s: LibrarySkill) => {
    setSkills((l) => l && l.map((x) => (x.id === s.id ? { ...x, enabled: !s.enabled } : x)));
    configApi.setLibrarySkill(s.id, !s.enabled).catch(() => setSkills((l) => l && l.map((x) => (x.id === s.id ? { ...x, enabled: s.enabled } : x))));
  };
  return (
    <>
      <PageHead title="Skills" sub="Built-in know-how your Bots use automatically when your message matches. Switch off any you don't want. Skills you write yourself live in each Bot's settings." />
      <section className="cfg-section">
        <div className="cfg-card" style={{ padding: 12, display: 'grid', gap: 8 }}>
          <textarea className="text-input" rows={2} placeholder="Add a skill: paste a GitHub link (repo or folder with a SKILL.md), or the SKILL.md text" value={src} onChange={(e) => setSrc(e.target.value)} />
          {err && <div className="cfg-row__sub" style={{ color: 'crimson' }}>{err}</div>}
          <button type="button" className="cfg-btn cfg-btn--primary" disabled={!src.trim()} onClick={add}>Add skill</button>
        </div>
      </section>
      <section className="cfg-section">
        <div className="cfg-card">
          {skills === null ? <div className="cfg-empty cfg-empty--flat">Loading…</div> : skills.length === 0 ? <div className="cfg-empty cfg-empty--flat">No built-in skills found.</div> : skills.map((s) => (
            <div key={s.id} className="cfg-row">
              <div className="cfg-row__text">
                <div className="cfg-row__title">{s.name}</div>
                <div className="cfg-row__sub">{s.description} Used when you say: {s.triggers.join(', ')}…</div>
              </div>
              {s.custom && <ConfirmButton className="cfg-btn cfg-btn--secondary" confirmLabel="Remove" onConfirm={async () => { await configApi.removeLibrarySkill(s.id); load(); }}>Remove</ConfirmButton>}
              <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => toggle(s)} aria-pressed={s.enabled}>{s.enabled ? 'On' : 'Off'}</button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function TelegramSection() {
  const [info, setInfo] = useState<TelegramInfo | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { configApi.telegram().then(setInfo).catch((e) => setError((e as Error).message)); }, []);
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load]);
  const run = (fn: () => Promise<unknown>) => { setError(null); fn().then(load).catch((e) => setError((e as Error).message)); };
  const label = info?.status === 'running' ? `Running as @${info.bot}` : info?.status === 'error' ? 'Problem' : 'Not connected';
  return (
    <>
      <PageHead title="Telegram" sub="Talk to your main Bot from Telegram. It runs on this computer: OpenKrishBot asks Telegram for your messages, nothing is hosted." />
      <section className="cfg-section">
        <div className="cfg-card" style={{ padding: 12, display: 'grid', gap: 8 }}>
          <div className="cfg-row__title">{label}{info && info.paired > 0 ? ` · ${info.paired} chat${info.paired === 1 ? '' : 's'} paired` : ''}</div>
          {(error || info?.error) && <div className="cfg-row__sub" style={{ color: 'crimson' }}>{error ?? info?.error}</div>}
          {!info?.hasToken ? (
            <>
              <div className="cfg-row__sub">1. In Telegram, open @BotFather, send /newbot and copy the token it gives you. 2. Paste it here.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="text-input" placeholder="123456:ABC-DEF…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
                <button type="button" className="cfg-btn cfg-btn--primary" disabled={!token.trim()} onClick={() => run(() => configApi.telegramToken(token.trim()).then(() => setToken('')))}>Connect</button>
              </div>
            </>
          ) : (
            <>
              <div className="cfg-row__sub">Only chats you pair can use your Bot. Click “New code”, then send <b>/pair CODE</b> to your bot in Telegram.</div>
              {info.pairCode && <div className="cfg-row__title" style={{ fontSize: 22, letterSpacing: 3 }}>/pair {info.pairCode}</div>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="cfg-btn cfg-btn--primary" onClick={() => run(configApi.telegramPairCode)}>New code</button>
                {info.status === 'off' ? <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => run(configApi.telegramStart)}>Turn on</button> : <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => run(configApi.telegramStop)}>Turn off</button>}
                <ConfirmButton className="cfg-btn cfg-btn--secondary" confirmLabel="Remove token and paired chats" onConfirm={async () => run(configApi.telegramUnlink)}>Disconnect</ConfirmButton>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}

function IssueNotes({ issueId, nameOf }: { issueId: string; nameOf: (id: string | null) => string }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ id: string; author: string; text: string }[]>([]);
  const [text, setText] = useState('');
  const load = useCallback(() => configApi.issueComments(issueId).then((r) => setList(r.comments)).catch(() => {}), [issueId]);
  useEffect(() => { if (!open) return; load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [open, load]);
  return (
    <div style={{ flexBasis: '100%' }}>
      <button type="button" className="cfg-link" onClick={() => setOpen(!open)}>{open ? 'Hide notes' : 'Notes'}</button>
      {open && (
        <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
          {list.map((c) => <div key={c.id} className="cfg-row__sub" style={{ whiteSpace: 'pre-wrap' }}><b>{c.author === 'user' ? 'You' : nameOf(c.author)}:</b> {c.text}</div>)}
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="text-input" style={{ flex: 1 }} placeholder="Add a note (the Bot is told)" value={text} onChange={(e) => setText(e.target.value)} />
            <button type="button" className="cfg-btn cfg-btn--primary" disabled={!text.trim()} onClick={async () => { await configApi.addIssueComment(issueId, text); setText(''); load(); }}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}
