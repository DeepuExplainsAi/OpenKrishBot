import { en, locales } from './index';
import { activeLocale, loadLocale, subscribeLocale } from './i18n';
import extra from './extra-hi.json';

/** The UI text is plain English in the components. This swaps each text node / title / placeholder for the active pack's
 * translation of the same English sentence (Maus's packs, keyed by English text), and restores English when switched back. */
let reverse: Map<string, string> | null = null;
const rev = () => reverse ??= new Map(Object.entries(en).filter(([, v]) => typeof v === 'string' && !v.includes('{')).map(([k, v]) => [(v as string).trim(), k]));
const orig = new WeakMap<Node, string>();
const ATTRS = ['title', 'placeholder', 'aria-label'];

function tr(text: string): string | undefined {
  const lead = text.match(/^\s*/)![0], tail = text.match(/\s*$/)![0], core = text.trim();
  if (!core) return undefined;
  const lang = activeLocale();
  const pack = locales[lang] as Record<string, string> | undefined;
  const key = rev().get(core.replace(/’/g, "'")) ?? rev().get(core);
  const hit = (key && pack?.[key]) || (lang === 'hi' ? (extra as Record<string, string>)[core] : undefined);
  return hit ? lead + hit + tail : undefined;
}

function node(n: Node, en_: boolean) {
  if (n.nodeType === 3) {
    const t = n as Text;
    if (en_) { const o = orig.get(t); if (o !== undefined && t.data !== o) t.data = o; return; }
    const o = orig.get(t) ?? t.data;
    const out = tr(o);
    if (out !== undefined) { orig.set(t, o); if (t.data !== out) t.data = out; }
  } else if (n.nodeType === 1) {
    const el = n as Element;
    if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(el.tagName) && el.tagName !== 'INPUT') return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a); const k = `data-en-${a}`;
      if (v === null) continue;
      if (en_) { const o = el.getAttribute(k); if (o !== null) { el.setAttribute(a, o); el.removeAttribute(k); } continue; }
      const o = el.getAttribute(k) ?? v; const out = tr(o);
      if (out !== undefined) { el.setAttribute(k, o); if (v !== out) el.setAttribute(a, out); }
    }
    el.childNodes.forEach((c) => node(c, en_));
  }
}

let busy = false;
const run = (root: Node) => { if (busy) return; busy = true; try { node(root, activeLocale() === 'en'); } finally { busy = false; } };

export function startTranslation(initial: string) {
  const mo = new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'characterData') run(m.target); else m.addedNodes.forEach(run); if (m.type === 'attributes') run(m.target); } });
  mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  subscribeLocale(() => run(document.body));
  void setUiLanguage(initial);
}

export async function setUiLanguage(tag: string) {
  localStorage.setItem('okb-ui-lang', tag);
  await loadLocale(tag);
  run(document.body);
}
export const uiLanguage = () => localStorage.getItem('okb-ui-lang') ?? 'en';
