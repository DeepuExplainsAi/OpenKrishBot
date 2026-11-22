// Shim: nod's lib/api.ts is tied to its accounts/feedback layer; the pages only use api() and errorMessage().
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ApiError'; }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* not json */ }
    throw new ApiError(msg, res.status);
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}
export function apiResponse(path: string, options: RequestInit = {}) {
  return fetch(path, { credentials: 'include', ...options });
}
export async function responseError(res: Response) {
  try { return new ApiError(((await res.json()) as { error?: string }).error ?? res.statusText, res.status); } catch { return new ApiError(res.statusText, res.status); }
}
