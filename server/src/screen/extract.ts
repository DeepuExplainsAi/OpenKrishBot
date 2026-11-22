/** Page-side script for browser_extract: fields are CSS selectors, optionally repeated per `each` row. "sel@attr" reads an attribute. */
export interface ExtractSpec { each?: string; fields: Record<string, string> }

export function extractScript(spec: ExtractSpec): string {
  return `((document) => {
  const spec = ${JSON.stringify(spec)};
  const read = (root, sel) => {
    const [css, attr] = sel.split('@');
    const e = css ? root.querySelector(css) : root;
    if (!e) return null;
    return (attr ? e.getAttribute(attr) : (e.innerText ?? e.textContent) || '').toString().trim().replace(/\\s+/g, ' ');
  };
  const one = (root) => Object.fromEntries(Object.entries(spec.fields).map(([k, sel]) => [k, read(root, sel)]));
  return spec.each ? [...document.querySelectorAll(spec.each)].slice(0, 200).map(one) : one(document);
})(document)`;
}

/** Tells a bot that keeps seeing the same page (same URL and elements) to change approach. */
const seen = new Map<string, { key: string; n: number }>();
export function stuckNote(botId: string, key: string, limit = 3): string {
  const s = seen.get(botId);
  const n = s?.key === key ? s.n + 1 : 1;
  seen.set(botId, { key, n });
  return n >= limit ? `\n\n[The page has not changed for ${n} looks in a row. Your last actions are not working: try something different (another element, another URL, scroll) or tell the user you are stuck.]` : '';
}

/** True when nothing matched: no rows, or a record whose fields are all empty (the page layout probably changed). */
export function extractEmpty(out: unknown): boolean {
  return Array.isArray(out) ? out.length === 0 : !!out && typeof out === 'object' && Object.values(out).every((v) => v === null);
}
