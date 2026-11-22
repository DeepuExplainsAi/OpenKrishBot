import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-'));
process.env.KRISH_STT_HOME = d;
// Stand-in for the venv python: ignores the script and prints one result line, like transcribe.py does.
const fake = path.join(d, 'fakepy.mjs');
fs.writeFileSync(fake, '#!/usr/bin/env node\nconsole.log("noise");console.log(JSON.stringify({language:"en",duration:3725,segments:[{start:1.2,end:3,text:"Hello team"},{start:3725,end:3726,text:"Bye"}]}));\n', { mode: 0o755 });
process.env.KRISH_STT_PYTHON = fake;
const { transcribeFile, transcriptText, stamp } = await import('../src/transcribe.js');

test('stamp formats mm:ss and h:mm:ss', () => {
  assert.equal(stamp(65.9), '01:05');
  assert.equal(stamp(3725), '1:02:05');
});
test('transcribeFile reads the last stdout line and formats text', async () => {
  const audio = path.join(d, 'a.mp3'); fs.writeFileSync(audio, 'x');
  const t = await transcribeFile(audio);
  assert.equal(t.language, 'en');
  assert.equal(transcriptText(t), '[00:01] Hello team\n[1:02:05] Bye');
  assert.ok(fs.existsSync(path.join(d, 'stt', 'transcribe.py')));
});
test('missing file gives a clear error', async () => {
  await assert.rejects(transcribeFile(path.join(d, 'nope.wav')), /File not found/);
});
