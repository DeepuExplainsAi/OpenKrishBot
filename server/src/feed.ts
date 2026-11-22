/** Minimal RSS 2.0 / Atom reader for feed triggers. No dependencies; tolerant of odd feeds. */
export interface FeedItem { id: string; title: string; link: string; summary: string; author: string; published: string }

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&').trim();
const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (b: string, n: string) => { const m = b.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i')); return m ? decode(m[1]) : ''; };

export function parseFeed(xml: string): FeedItem[] {
  const rss = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  if (rss.length) return rss.map((b) => {
    const link = tag(b, 'link');
    return { id: tag(b, 'guid') || link || tag(b, 'title'), title: strip(tag(b, 'title')), link, summary: strip(tag(b, 'description') || tag(b, 'content:encoded')).slice(0, 2000), author: tag(b, 'author') || tag(b, 'dc:creator'), published: tag(b, 'pubDate') || tag(b, 'dc:date') };
  });
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((m) => {
    const b = m[1];
    const href = decode(b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? '');
    return { id: tag(b, 'id') || href, title: strip(tag(b, 'title')), link: href, summary: strip(tag(b, 'summary') || tag(b, 'content')).slice(0, 2000), author: tag(tag(b, 'author'), 'name'), published: tag(b, 'published') || tag(b, 'updated') };
  });
}

export async function fetchFeed(url: string, fetchImpl: typeof fetch = fetch): Promise<FeedItem[]> {
  if (!/^https?:\/\//i.test(url)) throw new Error('A feed address must start with http:// or https://');
  const res = await fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0 (OpenKrishBot feed reader)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`The feed answered ${res.status}.`);
  const xml = await res.text();
  return parseFeed(xml.slice(0, 3_000_000));
}
