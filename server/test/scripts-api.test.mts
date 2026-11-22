import test from 'node:test';
import assert from 'node:assert/strict';
import { botForToken, disableScripts, enableScripts, scriptsEnabled } from '../src/scripts-api.ts';

test('script tokens: off by default, one token per bot, stored hashed, revocable', () => {
  assert.equal(scriptsEnabled('bot_x'), false);
  const t = enableScripts('bot_x');
  assert.match(t, /^okb_[0-9a-f]{48}$/);
  assert.equal(botForToken(t), 'bot_x');
  const t2 = enableScripts('bot_x');
  assert.equal(botForToken(t), null, 'a new token replaces the old one');
  assert.equal(botForToken(t2), 'bot_x');
  disableScripts('bot_x');
  assert.equal(botForToken(t2), null);
  assert.equal(botForToken('okb_nope'), null);
});
