import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

/** Free page reader: fetch, keep the main article (Mozilla Readability), return Markdown with links. No keys, no browser. */
const md = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
md.remove(['script', 'style', 'noscript', 'iframe']);

export async function fetchPage(url: string): Promise<{ title: string; markdown: string; links: string[] }> {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'accept-language': 'en' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  const type = r.headers.get('content-type') ?? '';
  const body = await r.text();
  if (!/html/i.test(type)) return { title: url, markdown: body, links: [] };
  const { document } = parseHTML(body);
  const links = [...document.querySelectorAll('a[href]')].map((a: any) => { try { return new URL(a.getAttribute('href'), r.url).href; } catch { return ''; } }).filter((h: string) => /^https?:/.test(h));
  const article = new Readability(document as any).parse();
  const title = article?.title || document.title || url;
  const html = article?.content && (article.textContent?.length ?? 0) > 200 ? article.content : document.body?.innerHTML ?? body;
  return { title, markdown: md.turndown(html), links: [...new Set<string>(links)].slice(0, 60) };
}
