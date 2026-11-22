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
