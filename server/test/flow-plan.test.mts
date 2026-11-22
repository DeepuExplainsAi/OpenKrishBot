import test from 'node:test';
import assert from 'node:assert/strict';
const { parsePlan, planPrompt } = await import('../src/flow-plan.js');

const bots = ['Ana', 'Raj'];

test('parsePlan: JSON inside prose, bot names matched, unknown needs dropped', () => {
  const steps = parsePlan('Sure!\n```json\n[{"id":"Research","bot":"raj","prompt":"find","needs":["zzz"]},{"id":"write","bot":"Nobody","prompt":"write {{Research}}","needs":["Research"]}]\n```', bots);
  assert.deepEqual(steps.map((s) => [s.id, s.bot, s.needs]), [['research', 'Raj', []], ['write', 'Ana', ['research']]]);
});

test('parsePlan: refuses text, bad JSON, loops', () => {
  assert.throws(() => parsePlan('no plan here', bots), /did not return/);
  assert.throws(() => parsePlan('[{oops]', bots), /not valid JSON/);
  assert.throws(() => parsePlan('[{"id":"a","prompt":"x","needs":["b"]},{"id":"b","prompt":"y","needs":["a"]}]', bots), /not usable/);
});

test('planPrompt lists the bots and the goal', () => assert.match(planPrompt('G', bots), /Ana, Raj[\s\S]*Goal: G/));
