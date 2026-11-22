/** Colour palettes: every themes/*.json is one ({ name, base, vars }); add a file to add a palette. */
export interface Palette { id: string; name: string; base: 'light' | 'dark'; vars: Record<string, string> }

const files = import.meta.glob<Omit<Palette, 'id'>>('../themes/*.json', { eager: true, import: 'default' });

export const PALETTES: Palette[] = Object.entries(files)
  .map(([path, p]) => ({ ...p, id: path.replace(/^.*\/|\.json$/g, '') }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Only colour variables may be overridden. */
const isColorVar = (k: string) => /^--color-[a-z0-9-]+$/.test(k);

export function applyPalette(id: string | null) {
  const root = document.documentElement;
  for (const p of PALETTES) for (const k of Object.keys(p.vars)) root.style.removeProperty(k);
  const p = PALETTES.find((x) => x.id === id);
  if (!p) return null;
  for (const [k, v] of Object.entries(p.vars)) if (isColorVar(k)) root.style.setProperty(k, v);
  return p;
}
