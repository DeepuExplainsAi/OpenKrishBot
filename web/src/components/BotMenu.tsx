import { useEffect, useState } from 'react';
import type { Bot } from '@shared/types';
import { api } from '../lib/api';
import { configApi } from '../lib/configApi';
import { useConfigUI } from '../configStore';
import { useStore } from '../store';
import { Menu, type MenuItem } from './Menu';

/** Everything you can do to a Bot from the sidebar: right-click it or use its “…” button. */
export function BotMenu({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const bots = useStore((s) => s.bots);
  const [paused, setPaused] = useState(false);
  const [departments, setDepartments] = useState<{ id: string; name: string }[] | null>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => { configApi.queue(bot.id).then((q) => setPaused(q.paused)).catch(() => {}); }, [bot.id]);

  const run = (p: Promise<unknown>) => p.catch((e) => window.alert(e.message));
  const ask = (text: string, then: () => Promise<unknown>) => { if (window.confirm(text)) run(then()); };

  if (moving) {
    const pick = (projectId: string | null) => { run(configApi.assignProject(bot.id, projectId)); onClose(); };
    const items: MenuItem[] = [
      { label: 'No department', keepOpen: true, onSelect: () => pick(null) },
      ...(departments ?? []).map((d) => ({ label: d.name, keepOpen: true, onSelect: () => pick(d.id) })),
    ];
    return <Menu className="menu--tall" align="right" onClose={onClose} items={items} />;
  }

  const items: MenuItem[] = [
    { label: 'New thread', onSelect: () => run(api.fresh(bot.id)) },
    { label: bot.pinned ? 'Unpin' : 'Pin', onSelect: () => run(configApi.updateBot(bot.id, { pinned: !bot.pinned })) },
    ...(bot.isPrimary || bot.kind === 'room' ? [] : [{ label: 'Make Chief of Staff', onSelect: () => run(api.makeChief(bot.id)) }]),
    ...(bot.kind === 'room' ? [] : [{
      label: 'Move to department',
      keepOpen: true,
      onSelect: () => { configApi.projects().then((r) => { setDepartments(r.projects.map((p) => ({ id: p.id, name: p.name }))); setMoving(true); }).catch(() => {}); },
    }]),
    { label: 'Mark as unread', onSelect: () => run(configApi.updateBot(bot.id, { unread: 1 })) },
    { label: 'Mark all as read', onSelect: () => bots.filter((b) => b.unread > 0).forEach((b) => run(api.markRead(b.id))) },
    ...(bot.kind === 'room' ? [] : [
      { label: 'Edit profile', onSelect: () => useConfigUI.getState().openBotSettings(bot.id) },
      { label: 'Duplicate', onSelect: () => run(api.duplicate(bot.id)) },
      { label: paused ? 'Resume bot' : 'Pause bot', onSelect: () => run(configApi.queueAction(bot.id, paused ? 'resume' : 'pause')) },
      { label: 'Pause every bot', onSelect: () => bots.forEach((b) => run(configApi.queueAction(b.id, 'pause'))) },
    ]),
    { label: 'Copy conversation ID', onSelect: () => navigator.clipboard?.writeText(bot.id) },
    { label: bot.archived ? 'Unarchive' : 'Archive', onSelect: () => run(configApi.updateBot(bot.id, { archived: !bot.archived })) },
    { label: 'Delete all threads…', danger: true, divider: true, onSelect: () => ask(`Delete every message with ${bot.name}?`, () => api.fresh(bot.id)) },
    { label: 'Delete…', danger: true, onSelect: () => ask(`Delete ${bot.name} and everything it knows? This cannot be undone.`, () => configApi.deleteBot(bot.id)) },
  ];
  return <Menu className="menu--tall" align="right" onClose={onClose} items={items} />;
}

/** The “+” menu in the sidebar header. */
export function AddMenu({ onClose }: { onClose: () => void }) {
  const setModal = useStore((s) => s.setModal);
  const selected = useStore((s) => s.selectedBotId);
  const [templates, setTemplates] = useState<{ id: string; name: string }[] | null>(null);
  const run = (p: Promise<unknown>) => p.catch((e) => window.alert(e.message));

  if (templates) {
    return <Menu className="menu--tall" align="right" onClose={onClose} items={templates.map((t) => ({ label: t.name, keepOpen: true, onSelect: () => { run(configApi.addCompanyTemplate(t.id)); onClose(); } }))} />;
  }
  const importFile = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => { const f = input.files?.[0]; if (f) run(f.text().then((t) => configApi.importCompany(JSON.parse(t)))); };
    input.click();
  };
  return (
    <Menu
      align="right"
      onClose={onClose}
      items={[
        ...(selected ? [{ label: 'New chat', onSelect: () => run(api.fresh(selected)) }] : []),
        { label: 'New bot', hint: 'Ctrl N', onSelect: () => setModal('create') },
        { label: 'New group chat', onSelect: () => setModal('group') },
        { label: 'Add department', onSelect: () => { const name = window.prompt('Department name')?.trim(); if (name) run(configApi.addProject({ name })); } },
        { label: 'Templates', keepOpen: true, onSelect: () => { configApi.companyTemplates().then((r) => setTemplates(r.templates)).catch(() => {}); } },
        { label: 'Import', onSelect: importFile },
      ]}
    />
  );
}
