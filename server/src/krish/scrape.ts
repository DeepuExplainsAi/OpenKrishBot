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

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const text = async (url: string) => { try { const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) }); return r.ok ? await r.text() : ''; } catch { return ''; } };

/** Disallow rules of robots.txt that apply to everyone (`User-agent: *`). */
export function robotsDisallow(robots: string): string[] {
  const out: string[] = [];
  let all = false;
  for (const raw of robots.split('\n')) {
    const line = raw.split('#')[0].trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'user-agent') all = m[2].trim() === '*';
    else if (all && key === 'disallow' && m[2].trim()) out.push(m[2].trim());
  }
  return out;
}

/** Page URLs listed in a sitemap.xml (one level of sub-sitemaps is not followed). */
export const sitemapUrls = (xml: string): string[] => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]).filter((u) => !/\.xml(\.gz)?$/i.test(u));

const cache = new Map<string, { at: number; page: Awaited<ReturnType<typeof fetchPage>> }>();
/** fetchPage, remembering results for 10 minutes so repeated reads cost nothing. */
export async function fetchPageCached(url: string) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 600_000) return hit.page;
  const page = await fetchPage(url);
  cache.set(url, { at: Date.now(), page });
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  return page;
}

export async function fetchPage(url: string): Promise<{ title: string; markdown: string; links: string[] }> {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  const body = await r.text();
  if (!/html/i.test(r.headers.get('content-type') ?? '')) return { title: url, markdown: body, links: [] };
  return htmlToMarkdown(body, r.url);
}

export interface CrawledPage { url: string; title: string; markdown: string }

/** Breadth-first crawl of one site (crawl4ai idea): same host only, bounded pages, optional path prefix. Free, no browser. */
export async function crawlSite(start: string, opts: { maxPages?: number; pathPrefix?: string; fetchOne?: typeof fetchPage; disallow?: string[]; seeds?: string[] } = {}): Promise<CrawledPage[]> {
  const { maxPages = 10, pathPrefix = '', fetchOne = fetchPageCached, disallow = [], seeds = [] } = opts;
  const host = new URL(start).host;
  const seen = new Set<string>([start]);
  const queue = [start];
  const allowed = (u: URL) => u.host === host && u.pathname.startsWith(pathPrefix) && !disallow.some((d) => u.pathname.startsWith(d));
  for (const sd of seeds) { try { const u = new URL(sd); u.hash = ''; if (allowed(u) && !seen.has(u.href)) { seen.add(u.href); queue.push(u.href); } } catch { /* bad url */ } }
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
        if (allowed(u) && !seen.has(href) && !/\.(png|jpe?g|gif|svg|pdf|zip|css|js)$/i.test(u.pathname)) { seen.add(href); queue.push(href); }
      }
    } catch { /* skip pages that fail */ }
  }
  return out;
}

/** crawlSite for a real site: honours robots.txt and seeds the queue from sitemap.xml. */
export async function crawlPolitely(start: string, opts: { maxPages?: number; pathPrefix?: string } = {}) {
  const origin = new URL(start).origin;
  const [robots, sitemap] = await Promise.all([text(`${origin}/robots.txt`), text(`${origin}/sitemap.xml`)]);
  return crawlSite(start, { ...opts, disallow: robotsDisallow(robots), seeds: sitemapUrls(sitemap) });
}
