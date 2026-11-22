import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

/** Free page reader: fetch, keep the main article (Mozilla Readability), return Markdown with links. No keys, no browser. */
const md = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
md.remove(['script', 'style', 'noscript', 'iframe']);

/** Main content of an HTML string as Markdown, plus absolute links. */
export function htmlToMarkdown(body: string, baseUrl: string): { title: string; markdown: string; links: string[] } {
  const { document } = parseHTML(body);
  const links = [...document.querySelectorAll('a[href]')].map((a: any) => { try { return new URL(a.getAttribute('href'), baseUrl).href; } catch { return ''; } }).filter((h: string) => /^https?:/.test(h));
  const article = new Readability(document as any).parse();
  const title = article?.title || document.title || baseUrl;
  const html = article?.content && (article.textContent?.length ?? 0) > 200 ? article.content : document.body?.innerHTML ?? body;
  return { title, markdown: md.turndown(html), links: [...new Set<string>(links)].slice(0, 60) };
}

export async function fetchPage(url: string): Promise<{ title: string; markdown: string; links: string[] }> {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'accept-language': 'en' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  const body = await r.text();
  if (!/html/i.test(r.headers.get('content-type') ?? '')) return { title: url, markdown: body, links: [] };
  return htmlToMarkdown(body, r.url);
}

export interface CrawledPage { url: string; title: string; markdown: string }

/** Breadth-first crawl of one site (crawl4ai idea): same host only, bounded pages, optional path prefix. Free, no browser. */
export async function crawlSite(start: string, opts: { maxPages?: number; pathPrefix?: string; fetchOne?: typeof fetchPage } = {}): Promise<CrawledPage[]> {
  const { maxPages = 10, pathPrefix = '', fetchOne = fetchPage } = opts;
  const host = new URL(start).host;
  const seen = new Set<string>([start]);
  const queue = [start];
  const out: CrawledPage[] = [];
  while (queue.length && out.length < Math.min(maxPages, 50)) {
    const url = queue.shift()!;
    try {
      const p = await fetchOne(url);
      out.push({ url, title: p.title, markdown: p.markdown });
      for (const l of p.links) {
        const u = new URL(l);
        u.hash = '';
        const href = u.href;
        if (u.host === host && u.pathname.startsWith(pathPrefix) && !seen.has(href) && !/\.(png|jpe?g|gif|svg|pdf|zip|css|js)$/i.test(u.pathname)) { seen.add(href); queue.push(href); }
      }
    } catch { /* skip pages that fail */ }
  }
  return out;
}
