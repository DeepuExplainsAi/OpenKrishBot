import test from 'node:test';
import assert from 'node:assert/strict';
process.env.HOME = '/tmp/h-test';
const { cleanCliText } = await import('../src/krish/cli.js');

test('gemini warnings are not part of the answer', () => {
  const raw = 'Warning: 256-color support not detected. Using a terminal with at least 256-color support is recommended.\nYOLO mode is enabled. All tool calls will be automatically approved.\n\u001b[32mHello there\u001b[0m\n';
  assert.equal(cleanCliText(raw), 'Hello there');
});
