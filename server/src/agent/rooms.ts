import { db, now } from '../db.js';
import { newId } from '../lib/ids.js';
import { hub } from '../lib/hub.js';
import { appendRow } from '../store.js';

/**
 * Group chats ("rooms").
 * A room is a bot row with kind='room' and a members list. It never runs its own agent loop:
 * a user message is dispatched to the members who should answer (@mentioned ones, else all,
 * capped), each member runs its normal loop with the group context and replies into the room
 * with post_to_group.
 */

const MAX_RESPONDERS = 3;

/** `@name` as a whole word, so @Sam does not also wake @Samantha. */
export const mentions = (lowerText: string, name: string) => new RegExp(`@${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'u').test(lowerText);

/** @mentioned members answer (capped). With no mention the group rotates: the next MAX_RESPONDERS members after the last one who was asked, so members past the third also get their turn. */
export function pickResponders<T extends { id: string }>(members: T[], mentioned: T[], lastId?: string | null): T[] {
  if (mentioned.length) return mentioned.slice(0, MAX_RESPONDERS);
  const start = (members.findIndex((m) => m.id === lastId) + 1) % members.length;
  return Array.from({ length: Math.min(MAX_RESPONDERS, members.length) }, (_, i) => members[(start + i) % members.length]);
}

export function initRooms() {
  for (const col of ["kind TEXT NOT NULL DEFAULT 'agent'", 'members TEXT']) {
    try { db.exec(`ALTER TABLE bots ADD COLUMN ${col}`); } catch (e: any) { if (!/duplicate column/i.test(e?.message)) throw e; }
  }
}

export const isRoom = (botId: string) => (db.prepare('SELECT kind FROM bots WHERE id=?').get(botId) as any)?.kind === 'room';

export function roomMembers(roomId: string): { id: string; name: string }[] {
  const r = db.prepare('SELECT members FROM bots WHERE id=?').get(roomId) as any;
  const ids: string[] = r?.members ? JSON.parse(r.members) : [];
  return ids.map((id) => db.prepare('SELECT id, name FROM bots WHERE id=?').get(id) as any).filter(Boolean);
}

export function createRoom(userId: string, name: string, memberIds: string[]) {
  const id = newId('room');
  db.prepare(
    `INSERT INTO bots(id,user_id,name,label,description,avatar_shape,avatar_color,kind,members,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,'room',?,?,?)`,
  ).run(id, userId, name.slice(0, 60), 'Group', `Group chat with ${memberIds.length} Bots`, 'cloud', 'gray', JSON.stringify(memberIds), now(), now());
  hub.emit(userId, { type: 'roster' });
  return id;
}

/** Called instead of the agent loop when the user posts in a room. */
export function dispatchRoomMessage(roomId: string, text: string, enqueue: (botId: string, t: any) => void) {
  const room = db.prepare('SELECT * FROM bots WHERE id=?').get(roomId) as any;
  const members = roomMembers(roomId);
  if (!members.length) {
    appendRow(roomId, 'notice', { type: 'notice', text: 'This group has no Bots yet.', tone: 'warn' });
    return;
  }
  const lower = text.toLowerCase();
  const mentioned = members.filter((m) => mentions(lower, m.name));
  const lastKey = `roomlast:${roomId}`;
  const responders = pickResponders(members, mentioned, (db.prepare('SELECT value FROM kv WHERE key=?').get(lastKey) as any)?.value);
  if (!mentioned.length) db.prepare('INSERT OR REPLACE INTO kv(key,value) VALUES (?,?)').run(lastKey, responders[responders.length - 1].id);
  const recent = (db.prepare("SELECT body FROM rows WHERE bot_id=? AND generation=? AND kind='message' ORDER BY seq DESC LIMIT 12").all(roomId, room.generation) as any[])
    .reverse()
    .map((r) => {
      const b = JSON.parse(r.body);
      return `${b.from?.name ?? (b.role === 'user' ? 'User' : 'Bot')}: ${String(b.text).slice(0, 600)}`;
    })
    .join('\n');
  for (const m of responders) {
    enqueue(m.id, {
      type: 'system',
      text:
        `[Group chat "${room.name}"] Members: ${members.map((x) => x.name).join(', ')}. ` +
        `${mentioned.length ? 'You were @mentioned.' : 'The user addressed the whole group.'}\n` +
        `Recent group messages:\n${recent}\n\n` +
        `Reply to the group by calling post_to_group with group_name "${room.name}" (use your tools first if the request needs real work). ` +
        `Keep it short and don't repeat what other Bots already said. If you have nothing to add, call stay_silent. Do not write a normal reply.`,
    });
  }
}

export function postToRoom(fromBotId: string, roomName: string, text: string) {
  const from = db.prepare('SELECT id, user_id, name FROM bots WHERE id=?').get(fromBotId) as any;
  const room = db.prepare("SELECT * FROM bots WHERE user_id=? AND kind='room' AND lower(name)=lower(?)").get(from.user_id, roomName.trim()) as any;
  if (!room) return `No group named "${roomName}".`;
  const members: string[] = room.members ? JSON.parse(room.members) : [];
  if (!members.includes(fromBotId)) return `You're not a member of "${room.name}".`;
  // One post per bot per user message: a bot that keeps posting cannot flood the room.
  const lastUser = (db.prepare("SELECT MAX(seq) s FROM rows WHERE bot_id=? AND generation=? AND kind='message' AND json_extract(body,'$.role')='user'").get(room.id, room.generation) as any)?.s ?? 0;
  const already = db.prepare("SELECT 1 FROM rows WHERE bot_id=? AND generation=? AND seq>? AND kind='message' AND json_extract(body,'$.from.id')=?").get(room.id, room.generation, lastUser, fromBotId);
  if (already) return `You already replied to the latest message in "${room.name}". Wait for the next one.`;
  appendRow(room.id, 'message', { type: 'message', role: 'assistant', text, from: { kind: 'bot', id: from.id, name: from.name } });
  db.prepare('UPDATE bots SET unread = unread + 1 WHERE id=?').run(room.id);
  return 'Posted to the group.';
}
