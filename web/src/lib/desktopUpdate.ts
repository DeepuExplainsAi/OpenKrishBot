// nod's src/web/lib/desktop.ts update bridge (types and calls), on the `krishDesktop` preload object.
export type DesktopUpdateStatus = {
  phase: 'idle' | 'checking' | 'preparing' | 'downloading' | 'ready';
  checking: boolean;
  progress?: number;
  readyVersion?: string;
  dismissedVersion?: string;
  failure?: { id: number; phase: 'checking' | 'preparing' | 'downloading' | 'restart'; message: string; dismissed?: boolean };
};
type Bridge = {
  updateStatus?(): Promise<DesktopUpdateStatus>;
  onUpdateStatus?(listener: (status: DesktopUpdateStatus) => void): () => void;
  dismissUpdate?(version: string | number): Promise<void>;
  retryUpdate?(id: number): Promise<void>;
  downloadUpdate?(): Promise<void>;
  restartUpdate?(): Promise<void>;
};
const bridge = () => (window as unknown as { krishDesktop?: Bridge }).krishDesktop;
const need = <T,>(fn: T | undefined): T => { if (!fn) throw new Error('Desktop updates are unavailable.'); return fn; };

export const desktopUpdateStatus = () => bridge()?.updateStatus?.();
export const subscribeDesktopUpdateStatus = (listener: (status: DesktopUpdateStatus) => void) => bridge()?.onUpdateStatus?.(listener) ?? (() => {});
export const dismissDesktopUpdate = (version: string | number) => { try { return need(bridge()?.dismissUpdate)(version); } catch (e) { return Promise.reject(e); } };
export const retryDesktopUpdate = (id: number) => { try { return need(bridge()?.retryUpdate)(id); } catch (e) { return Promise.reject(e); } };
export const downloadDesktopUpdate = () => { try { return need(bridge()?.downloadUpdate)(); } catch (e) { return Promise.reject(e); } };
export const restartDesktopUpdate = () => { try { return need(bridge()?.restartUpdate)(); } catch (e) { return Promise.reject(e); } };
