import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchPage } from '../src/krish/scrape.ts';

test('fetchPage returns the article as markdown and resolves links', async () => {
  const srv = http.createServer((_q, res) => { res.setHeader('content-type', 'text/html'); res.end(`<html><head><title>T</title></head><body><nav>menu</nav><article><h1>Hello</h1><p>${'word '.repeat(80)}</p><a href="/x">more</a></article></body></html>`); }).listen(0);
  const { port } = srv.address() as any;
  try {
    const p = await fetchPage(`http://127.0.0.1:${port}/`);
    assert.match(p.markdown, /# Hello/);
    assert.ok(p.links.includes(`http://127.0.0.1:${port}/x`));
  } finally { srv.close(); }
});

import { crawlSite } from '../src/krish/scrape.ts';
test('crawlSite stays on the host and prefix, never repeats, respects the limit', async () => {
  const site: Record<string, string[]> = {
    'https://a.test/docs/': ['https://a.test/docs/x', 'https://b.test/y', 'https://a.test/blog/z', 'https://a.test/docs/logo.png'],
    'https://a.test/docs/x': ['https://a.test/docs/', 'https://a.test/docs/w#top'],
    'https://a.test/docs/w': [],
  };
  const fetchOne = async (u: string) => ({ title: u, markdown: 'm', links: site[u] ?? [] });
  const pages = await crawlSite('https://a.test/docs/', { pathPrefix: '/docs', fetchOne });
  assert.deepEqual(pages.map((p) => p.url), ['https://a.test/docs/', 'https://a.test/docs/x', 'https://a.test/docs/w']);
  assert.equal((await crawlSite('https://a.test/docs/', { maxPages: 1, fetchOne })).length, 1);
});

import { robotsDisallow, sitemapUrls } from '../src/krish/scrape.ts';
test('robots and sitemap parsing; disallow and seeds steer the crawl', async () => {
  assert.deepEqual(robotsDisallow('User-agent: bot\nDisallow: /x\nUser-agent: *\nDisallow: /private # c\nDisallow:\nAllow: /'), ['/private']);
  assert.deepEqual(sitemapUrls('<urlset><url><loc> https://a.test/p1 </loc></url><loc>https://a.test/s.xml</loc></urlset>'), ['https://a.test/p1']);
  const fetchOne = async (u: string) => ({ title: u, markdown: '', links: ['https://a.test/private/x'] });
  const pages = await crawlSite('https://a.test/', { fetchOne, disallow: ['/private'], seeds: ['https://a.test/p1', 'https://a.test/private/y'] });
  assert.deepEqual(pages.map((p) => p.url), ['https://a.test/', 'https://a.test/p1']);
});
