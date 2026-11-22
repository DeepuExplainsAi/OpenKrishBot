/** Per-browser settings in localStorage under `openkrishbot.<name>`. */
export function lsGet(name: string): string | null {
  try { return localStorage.getItem(`openkrishbot.${name}`); } catch { return null; }
}

export function lsSet(name: string, value: string) {
  try { localStorage.setItem(`openkrishbot.${name}`, value); } catch { /* storage unavailable */ }
}
