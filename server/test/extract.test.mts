import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { extractScript, stuckNote } from '../src/screen/extract.ts';

const { document } = parseHTML(`<div class=p><h2>Cap</h2><b class=price> $5 </b><a href="/cap">x</a></div><div class=p><h2>Mug</h2><a href="/mug">x</a></div>`);
const run = (spec: any) => new Function('document', `return ${extractScript(spec)}`)(document);

test('extract: rows with text and attributes, missing fields are null', () => {
  assert.deepEqual(run({ each: 'div.p', fields: { title: 'h2', price: '.price', link: 'a@href' } }), [
    { title: 'Cap', price: '$5', link: '/cap' }, { title: 'Mug', price: null, link: '/mug' }]);
  assert.deepEqual(run({ fields: { first: 'h2' } }), { first: 'Cap' });
});

test('stuck: warns on the 3rd identical look, resets on change', () => {
  assert.equal(stuckNote('b', 'k'), '');
  assert.equal(stuckNote('b', 'k'), '');
  assert.match(stuckNote('b', 'k'), /not changed for 3/);
  assert.equal(stuckNote('b', 'other'), '');
});
