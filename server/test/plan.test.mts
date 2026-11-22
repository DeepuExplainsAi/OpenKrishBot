import test from 'node:test';
import assert from 'node:assert/strict';
const { newSteps, markStep, render, loopNudge } = await import('../src/plan.js');

test('first step starts as doing, empty steps dropped', () => {
  const s = newSteps(['a', ' ', 'b']);
  assert.deepEqual(s.map((x) => x.status), ['doing', 'todo']);
});
test('finishing a step advances the next one', () => {
  let s = newSteps(['a', 'b', 'c']);
  s = markStep(s, 0, 'done', 'ok').steps;
  assert.deepEqual(s.map((x) => x.status), ['done', 'doing', 'todo']);
  assert.equal(s[0].note, 'ok');
});
test('bad index or status is an error and changes nothing', () => {
  const s = newSteps(['a', 'b']);
  assert.match(markStep(s, 5, 'done').error!, /no step 5/);
  assert.match(markStep(s, 0, 'finished').error!, /status must be/);
  assert.equal(markStep(s, 5, 'done').steps, s);
});
test('blocked with nothing else to do leaves no doing step', () => {
  let s = newSteps(['a']);
  s = markStep(s, 0, 'blocked', 'need login').steps;
  assert.equal(s[0].status, 'blocked');
  assert.match(render('T', s), /\[!\] a — need login/);
});
test('render counts done', () => {
  const s = markStep(newSteps(['a', 'b']), 0, 'done').steps;
  assert.match(render('T', s), /^Plan: T \(1\/2 done\)\n0\. \[✓\] a\n1\. \[→\] b/);
});
test('loop nudge fires on the third identical call only', () => {
  const r: string[] = [];
  assert.equal(loopNudge(r, 'x'), null);
  assert.equal(loopNudge(r, 'x'), null);
  assert.match(loopNudge(r, 'x')!, /different approach/);
  assert.equal(loopNudge(r, 'y'), null);
});
