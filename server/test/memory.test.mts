import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveNote } from '../src/krish/memory.ts';

test('notes: add, dedupe, update, replace, forget', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mem-')), 'm', 'USER.md');
  assert.equal(saveNote(f, 'Prefers short answers in Hindi'), 'Saved.');
  assert.equal(saveNote(f, 'prefers short answers in hindi'), 'Already saved.');
  assert.equal(saveNote(f, 'Prefers short answers in Hindi and English'), 'Updated.');
  assert.equal(saveNote(f, 'Lives in Pune'), 'Saved.');
  assert.equal(saveNote(f, 'Lives in Mumbai', { replaces: 'Lives in Pune' }), 'Updated.');
  assert.equal(fs.readFileSync(f, 'utf8'), 'Prefers short answers in Hindi and English\n§\nLives in Mumbai\n');
  assert.equal(saveNote(f, 'Mumbai', { forget: true }), 'Forgotten.');
  assert.equal(saveNote(f, 'unrelated', { forget: true }), 'No matching note.');
  assert.equal(fs.readFileSync(f, 'utf8'), 'Prefers short answers in Hindi and English\n');
});
