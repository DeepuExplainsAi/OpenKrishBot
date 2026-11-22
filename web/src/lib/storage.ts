/** Per-browser settings in localStorage under `bothq.<name>`. */
export function lsGet(name: string): string | null {
  try { return localStorage.getItem(`bothq.${name}`); } catch { return null; }
}

export function lsSet(name: string, value: string) {
  try { localStorage.setItem(`bothq.${name}`, value); } catch { /* storage unavailable */ }
}
