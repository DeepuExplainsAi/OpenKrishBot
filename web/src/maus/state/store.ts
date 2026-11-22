// Adapter: OpenMausBot's store API on OpenKrishBot's plain fetch.
export interface ConfigStatus { [key: string]: unknown }
export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}
export const useStore = () => ({ state: { bots: [] as Array<{ id: string; name: string; hidden?: boolean }>, config: {} as any }, dispatch: (_a: unknown) => {} });
