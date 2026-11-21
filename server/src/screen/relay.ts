import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { db } from '../db.js';
import { isSameOriginRequest, userFromCookieHeader } from '../lib/auth.js';
import { screenOf, watch } from './manager.js';

/** Live view: browser <-> this server. Binary messages out are JPEG frames; JSON in is mouse/keyboard (control mode only). */

const header = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h);

export function attachScreenRelay(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const m = url.pathname.match(/^\/api\/bots\/([^/]+)\/screen$/);
    if (!m) return;
    if (!isSameOriginRequest(header(req.headers.origin), header(req.headers['sec-fetch-site']))) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    const user = userFromCookieHeader(req.headers.cookie);
    const bot = user ? db.prepare('SELECT id FROM bots WHERE id=? AND user_id=?').get(m[1], user.id) as { id: string } | undefined : undefined;
    if (!user || !bot) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    const control = url.searchParams.get('mode') === 'control';
    wss.handleUpgrade(req, socket, head, (ws) => serve(ws, bot.id, control));
  });
}

const BUTTONS = ['left', 'middle', 'right'] as const;

async function serve(ws: WebSocket, botId: string, control: boolean) {
  let stop: (() => void) | null = null;
  let gone = false;
  ws.on('close', () => { gone = true; stop?.(); });
  try {
    let lastSize = '';
    const un = await watch(botId, (f) => {
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 2_000_000) return;
      const size = `${f.w}x${f.h}`;
      if (size !== lastSize) { lastSize = size; ws.send(JSON.stringify({ t: 'size', w: f.w, h: f.h })); }
      ws.send(f.jpeg);
    });
    if (gone) return un();
    stop = un;
  } catch (e: any) { ws.close(1011, String(e?.message ?? e).slice(0, 120)); return; }
  if (!control) return;
  ws.on('message', async (raw, isBinary) => {
    if (isBinary) return;
    try {
      const m = JSON.parse(String(raw));
      const s = await screenOf(botId);
      if (m.t === 'mouse') {
        const type = m.k === 'down' ? 'mousePressed' : m.k === 'up' ? 'mouseReleased' : 'mouseMoved';
        await s.send('Input.dispatchMouseEvent', { type, x: m.x, y: m.y, button: BUTTONS[m.b] ?? 'none', buttons: m.buttons ?? 0, clickCount: m.k === 'move' ? 0 : 1 });
      } else if (m.t === 'wheel') {
        await s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: m.x, y: m.y, deltaX: m.dx, deltaY: m.dy });
      } else if (m.t === 'key') {
        const printable = typeof m.key === 'string' && m.key.length === 1 && !m.ctrl && !m.meta;
        await s.send('Input.dispatchKeyEvent', {
          type: m.k === 'down' ? (printable ? 'keyDown' : 'rawKeyDown') : 'keyUp', key: m.key, code: m.code, windowsVirtualKeyCode: m.vk ?? 0,
          modifiers: (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0), ...(m.k === 'down' && printable ? { text: m.key } : {}),
        });
      } else if (m.t === 'text') {
        await s.send('Input.insertText', { text: String(m.text) });
      }
    } catch { /* a bad input event is dropped */ }
  });
}
