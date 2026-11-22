import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { configApi } from '../lib/configApi';
import { useConfigUI } from '../configStore';
import { TasksIsland } from './config/TasksView';
import type { Bot } from '@shared/types';
import { BotAvatarFor } from '../avatar/BotAvatar';
import { displayName, useStore } from '../store';
import { api } from '../lib/api';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { AddMenu, BotMenu } from './BotMenu';

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export function TrafficLights() {
  return (
    <div className="traffic-lights" aria-hidden>
      <span style={{ background: '#FF5F57' }} />
      <span style={{ background: '#FEBC2E' }} />
      <span style={{ background: '#28C840' }} />
    </div>
  );
}

function previewFor(bot: Bot, running: boolean, awaiting: string | null) {
  if (awaiting) return `Waiting for you: ${awaiting}`;
  if (running && !bot.lastPreview) return 'Working…';
  return bot.lastPreview ?? 'No messages yet';
}

const BotRow = memo(function BotRow({ bot, selected, running, awaiting, onSelect }: { bot: Bot; selected: boolean; running: boolean; awaiting: string | null; onSelect: (id: string) => void }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="bot-row-wrap" onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}>
      <button type="button" className={`bot-row${selected ? ' is-selected' : ''}`} onClick={() => onSelect(bot.id)} aria-current={selected || undefined}>
        <span className="bot-row__avatar">
          <BotAvatarFor bot={bot} size={36} />
          {(running || awaiting || bot.unread > 0) && (
            <span className={`status-dot ${awaiting ? 'is-attention' : running ? 'is-working' : 'is-unread'}`} aria-label={awaiting ? 'Needs attention' : running ? 'Working' : 'Unread activity'} />
          )}
        </span>
        <span className="bot-row__text">
          <span className="bot-row__name">{bot.pinned ? '📌 ' : ''}{displayName(bot)}</span>
          <span className="bot-row__preview">{previewFor(bot, running, awaiting)}</span>
        </span>
      </button>
      <button type="button" className="bot-row__more icon-btn icon-btn--plain" onClick={() => setMenu(!menu)} aria-label={`Options for ${bot.name}`} aria-haspopup="menu"><Icon name="more" opacity={0.66} /></button>
      {menu && <BotMenu bot={bot} onClose={() => setMenu(false)} />}
    </div>
  );
});

/** The Chief of Staff's tile; the pencil renames it in place. */
function ChiefTile({ bot, selected, collapsed, working, onSelect }: { bot: Bot; selected: boolean; collapsed: boolean; working: boolean; onSelect: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(bot.name);
  const [menu, setMenu] = useState(false);
  const save = () => {
    const next = name.trim();
    setEditing(false);
    if (next && next !== bot.name) configApi.updateBot(bot.id, { name: next }).catch((e) => window.alert(e.message));
    else setName(bot.name);
  };
  return (
    <div className="pinned" onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}>
      <button type="button" className={`pinned__tile${selected ? ' is-selected' : ''}`} onClick={() => onSelect(bot.id)} title={displayName(bot)}>
        <span className="pinned__avatar">
          <BotAvatarFor bot={bot} size={collapsed ? 44 : 60} star />
          {working && <span className="status-dot is-working pinned__dot" />}
        </span>
        {!collapsed && !editing && <span className="pinned__label">{displayName(bot)}</span>}
      </button>
      {!collapsed && editing && (
        <input className="pinned__input" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') { setName(bot.name); setEditing(false); } }} aria-label="Chief of Staff name" />
      )}
      {!collapsed && !editing && (
        <button type="button" className="pinned__edit icon-btn icon-btn--plain" onClick={() => { setName(bot.name); setEditing(true); }} aria-label="Rename" title="Rename"><Icon name="edit" size={14} opacity={0.66} /></button>
      )}
      {menu && <BotMenu bot={bot} onClose={() => setMenu(false)} />}
    </div>
  );
}

export function Sidebar() {
  const bots = useStore((s) => s.bots);
  const live = useStore((s) => s.live);
  const storeSelectedBotId = useStore((s) => s.selectedBotId);
  const inTasks = useConfigUI((s) => s.view === 'tasks');
  const selectedBotId = inTasks ? null : storeSelectedBotId; // nothing highlighted while the Tasks view is open
  const user = useStore((s) => s.user);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const set = useStore((s) => s.set);
  const storeSelectBot = useStore((s) => s.selectBot);
  // Picking a bot (even the one already selected) leaves the Tasks view.
  const selectBot = useCallback((id: string) => { useConfigUI.getState().setView('chat'); storeSelectBot(id); }, [storeSelectBot]);
  const setModal = useStore((s) => s.setModal);
  const [accountMenu, setAccountMenu] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const logout = async () => { await api.logout().catch(() => {}); location.reload(); };

  const primary = bots.find((b) => b.isPrimary);
  const archived = bots.filter((b) => !b.isPrimary && b.archived);
  const others = bots.filter((b) => !b.isPrimary && !b.archived).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  // Bots of a company are listed under its name.
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const companyKey = bots.map((b) => b.projectId ?? '').join(',');
  useEffect(() => { configApi.projects().then((r) => setCompanies(Object.fromEntries(r.projects.map((p) => [p.id, p.name])))).catch(() => {}); }, [companyKey]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof others>();
    for (const b of others) { const k = b.projectId && companies[b.projectId] ? b.projectId : ''; m.set(k, [...(m.get(k) ?? []), b]); }
    return [...m.entries()].sort((a, b) => (a[0] === '' ? 1 : 0) - (b[0] === '' ? 1 : 0));
  }, [others, companies]);

  return (
    <aside className={`sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <div className="sidebar__titlebar">
        <TrafficLights />
        <div className="sidebar__controls">
          <button type="button" className="icon-btn icon-btn--plain" onClick={() => set({ sidebarCollapsed: !collapsed })} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title="Toggle sidebar (⌘B)">
            <Icon name="sidebar" opacity={0.66} />
          </button>
          {!collapsed && (
            <>
              <button type="button" className="icon-btn" onClick={() => setModal('search')} aria-label="Search" title="Search (⌘K)">
                <Icon name="search" opacity={0.66} />
              </button>
              <span className="sidebar__add">
                <button type="button" className="icon-btn" onClick={() => setAddMenu(!addMenu)} aria-label="Add" aria-haspopup="menu" title="New bot, chat, department…">
                  <Icon name="plus" opacity={0.66} />
                </button>
                {addMenu && <AddMenu onClose={() => setAddMenu(false)} />}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="sidebar__scroll">
        <TasksIsland />
        {primary && (
          <ChiefTile bot={primary} selected={selectedBotId === primary.id} collapsed={collapsed} working={!!live[primary.id]?.isRunning} onSelect={selectBot} />
        )}
        <div className="bot-list">
          {groups.map(([key, list]) => (
            <div key={key || 'none'}>
              {!collapsed && key && <div className="bot-group__title">{companies[key]}</div>}
              {list.map((b) =>
                collapsed ? (
                  <button key={b.id} type="button" className={`bot-rail-item${selectedBotId === b.id ? ' is-selected' : ''}`} onClick={() => selectBot(b.id)} title={displayName(b)}>
                    <BotAvatarFor bot={b} size={36} />
                  </button>
                ) : (
                  <BotRow key={b.id} bot={b} selected={selectedBotId === b.id} running={!!live[b.id]?.isRunning} awaiting={live[b.id]?.awaiting?.reason ?? null} onSelect={selectBot} />
                ),
              )}
            </div>
          ))}
          {!collapsed && archived.length > 0 && (
            <>
              <button type="button" className="bot-group__title bot-group__toggle" onClick={() => setShowArchived(!showArchived)}>Archived ({archived.length}) {showArchived ? '▾' : '▸'}</button>
              {showArchived && archived.map((b) => <BotRow key={b.id} bot={b} selected={selectedBotId === b.id} running={false} awaiting={null} onSelect={selectBot} />)}
            </>
          )}
          {!collapsed && others.length === 0 && (
            <button type="button" className="bot-list__empty" onClick={() => setModal('create')}>
              <span className="bot-list__empty-plus"><Icon name="plus" size={14} opacity={0.66} /></span>
              <span>
                <span className="bot-row__name">Create a Bot</span>
                <span className="bot-row__preview">Give it a job, like research or inbox triage</span>
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="sidebar__footer">
        <div className="sidebar__fade" />
        {!collapsed && (
          <div className="account">
            <button type="button" className="account__btn" onClick={() => setAccountMenu(!accountMenu)} aria-haspopup="menu" aria-expanded={accountMenu} title={user?.email}>
              <span className="account__initials">{initials(user?.name ?? user?.email ?? '')}</span>
              <span className="account__name">{user?.name ?? user?.email}</span>
            </button>
            {accountMenu && (
              <Menu
                placement="above"
                onClose={() => setAccountMenu(false)}
                items={[
                  { label: 'Settings', hint: '⌘,', onSelect: () => useConfigUI.getState().openAppSettings() },
                  { label: 'Connect apps', onSelect: () => setModal('apps') },
                  { label: 'Log out', danger: true, onSelect: logout },
                ]}
              >
                <div className="menu__header">{user?.email}</div>
              </Menu>
            )}
          </div>
        )}
        <button type="button" className="icon-btn icon-btn--bordered" onClick={() => setModal('apps')} aria-label="Connect apps" title="Connect apps">
          <Icon name="apps" />
        </button>
      </div>
    </aside>
  );
}
