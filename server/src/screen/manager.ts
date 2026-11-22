/** What a bot's browser shows until it opens a page: never an empty (black when captured) tab. */
export const START_PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset=utf-8><title>New tab</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#fff;color:#6b7280;font:18px system-ui">Ready. Waiting for the first page…</body>');
import { Cdp, launch, profileDirFor, SCREEN_H, SCREEN_W, type Running } from './cdp.js';

/** One Chrome per bot, started on first use. Its profile lives in ~/.openkrishbot/profiles/<bot>, so logins stay. */

export interface Frame { jpeg: Buffer; w: number; h: number }
type FrameFn = (f: Frame) => void;

class BotScreen {
  run!: Running;
  session = '';
  target = '';
  viewers = new Set<FrameFn>();
  last: Frame | null = null;
  idleTimer: NodeJS.Timeout | null = null;
  /** Latest page messages and requests (for browser_console / browser_network), oldest dropped. */
  console: string[] = [];
  requests = new Map<string, { method: string; url: string; status?: number; type?: string }>();
  dialog = '';

  constructor(readonly botId: string) {}

  get cdp(): Cdp { return this.run.cdp; }

  async start() {
    this.run = await launch(profileDirFor(this.botId));
    const cdp = this.cdp;
    cdp.on('closed', () => { screens.delete(this.botId); });
    cdp.on('Target.targetCreated', (p) => { if (p.targetInfo.type === 'page' && p.targetInfo.openerId) this.attach(p.targetInfo.targetId).catch(() => {}); });
    cdp.on('Target.targetDestroyed', async (p) => {
      if (p.targetId !== this.target) return;
      const { targetInfos } = await cdp.send('Target.getTargets');
      const next = targetInfos.find((t: any) => t.type === 'page');
      if (next) await this.attach(next.targetId); else await this.openTab(START_PAGE);
    });
    cdp.on('Runtime.consoleAPICalled', (p, sid) => { if (sid === this.session) this.log(`${p.type}: ${(p.args ?? []).map((a: any) => a.value ?? a.description ?? a.type).join(' ')}`); });
    cdp.on('Runtime.exceptionThrown', (p, sid) => { if (sid === this.session) this.log(`error: ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}`); });
    cdp.on('Network.requestWillBeSent', (p, sid) => { if (sid !== this.session) return; this.requests.set(p.requestId, { method: p.request.method, url: p.request.url, type: p.type }); if (this.requests.size > 300) this.requests.delete(this.requests.keys().next().value!); });
    cdp.on('Network.responseReceived', (p, sid) => { const r = sid === this.session ? this.requests.get(p.requestId) : null; if (r) r.status = p.response.status; });
    cdp.on('Page.javascriptDialogOpening', (p, sid) => { if (sid === this.session) this.dialog = `${p.type}: ${p.message}`; });
    cdp.on('Page.screencastFrame', (p, sid) => {
      cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }, sid).catch(() => {});
      if (sid !== this.session) return;
      const f = { jpeg: Buffer.from(p.data, 'base64'), w: p.metadata.deviceWidth || SCREEN_W, h: p.metadata.deviceHeight || SCREEN_H };
      this.last = f;
      this.viewers.forEach((v) => v(f));
    });
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    const { targetInfos } = await cdp.send('Target.getTargets');
    const page = targetInfos.find((t: any) => t.type === 'page');
    if (page) await this.attach(page.targetId); else await this.openTab(START_PAGE);
  }

  async openTab(url: string) {
    const { targetId } = await this.cdp.send('Target.createTarget', { url });
    await this.attach(targetId);
  }

  async attach(targetId: string) {
    if (this.target === targetId && this.session) return;
    if (this.session) await this.cdp.send('Page.stopScreencast', {}, this.session).catch(() => {});
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    this.target = targetId; this.session = sessionId;
    await Promise.all([
      this.cdp.send('Page.enable', {}, sessionId),
      this.cdp.send('Runtime.enable', {}, sessionId),
      this.cdp.send('Network.enable', {}, sessionId),
      this.cdp.send('Emulation.setDeviceMetricsOverride', { width: SCREEN_W, height: SCREEN_H, deviceScaleFactor: 1, mobile: false }, sessionId),
      // pages without their own background are white, as in a normal browser (headless would capture them black)
      this.cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 255, g: 255, b: 255, a: 1 } }, sessionId).catch(() => {}),
    ]);
    await this.cdp.send('Target.activateTarget', { targetId }).catch(() => {});
    if (this.viewers.size) await this.startCast();
  }

  log(line: string) { this.console.push(line.slice(0, 500)); if (this.console.length > 200) this.console.shift(); }

  async tabs(): Promise<{ id: string; url: string; title: string; active: boolean }[]> {
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    return targetInfos.filter((t: any) => t.type === 'page').map((t: any) => ({ id: t.targetId, url: t.url, title: t.title, active: t.targetId === this.target }));
  }

  async closeTab(targetId: string) { await this.cdp.send('Target.closeTarget', { targetId }); }

  startCast() {
    return this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: SCREEN_W, maxHeight: SCREEN_H, everyNthFrame: 1 }, this.session);
  }

  send<T = any>(method: string, params: object = {}): Promise<T> { return this.cdp.send<T>(method, params, this.session); }

  async eval<T = any>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  async shot(): Promise<Frame> {
    const r = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
    return { jpeg: Buffer.from(r.data, 'base64'), w: SCREEN_W, h: SCREEN_H };
  }

  stop() {
    try { this.cdp.close(); } catch { /* */ }
    try { this.run.proc.kill(); } catch { /* */ }
    screens.delete(this.botId);
  }
}

const screens = new Map<string, BotScreen>();
const starting = new Map<string, Promise<BotScreen>>();

export function screenIfRunning(botId: string) { return screens.get(botId) ?? null; }
export const runningBots = () => [...screens.keys()];

export function screenOf(botId: string): Promise<BotScreen> {
  const have = screens.get(botId);
  if (have) return Promise.resolve(have);
  let p = starting.get(botId);
  if (!p) {
    p = (async () => {
      const s = new BotScreen(botId);
      await s.start();
      screens.set(botId, s);
      return s;
    })().finally(() => starting.delete(botId));
    starting.set(botId, p);
  }
  return p;
}

/** Subscribe to live frames. Starts the stream while anyone watches, stops it after the last one leaves. */
export async function watch(botId: string, fn: FrameFn): Promise<() => void> {
  const s = await screenOf(botId);
  const first = s.viewers.size === 0;
  s.viewers.add(fn);
  if (first) await s.startCast().catch(() => {});
  s.shot().then(fn).catch(() => {});
  return () => {
    s.viewers.delete(fn);
    if (!s.viewers.size && screens.get(botId) === s) s.send('Page.stopScreencast').catch(() => {});
  };
}

export const closeScreen = (botId: string) => screens.get(botId)?.stop();
export const closeAllScreens = () => [...screens.values()].forEach((s) => s.stop());
process.on('exit', closeAllScreens);
