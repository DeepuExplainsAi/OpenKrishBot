import { Hono } from 'hono';
import path from 'node:path';
import os from 'node:os';
import { requireUser, type AuthVars } from './lib/auth.js';
import { createLocalSpeechProvider } from './local-speech/index.ts';

/** /api/speech: nod's on-device speech (Kokoro voices + Whisper-style input), nothing leaves this computer. */
export const speechApi = new Hono<AuthVars>();
speechApi.use('*', requireUser);

const local = createLocalSpeechProvider({ cacheDir: path.join(os.homedir(), '.openkrishbot', 'speech') });
const state = () => ({ local: local.status(), localInput: local.transcriptionStatus(), voices: local.voices, defaultVoice: local.defaultVoice });

speechApi.get('/', (c) => c.json(state()));
speechApi.post('/prepare', async (c) => {
  const { inputOnly } = await c.req.json().catch(() => ({}));
  await (inputOnly ? local.prepareTranscription(c.req.raw.signal) : local.prepare(c.req.raw.signal));
  return c.json(state());
});
speechApi.post('/speak', async (c) => {
  const { text, voice } = await c.req.json().catch(() => ({}));
  if (typeof text !== 'string' || !text.trim() || text.length > 5000) return c.json({ error: 'text required (max 5000 chars)' }, 400);
  const audio = await local.synthesize(text, c.req.raw.signal, undefined, { voice });
  return new Response(audio.bytes, { headers: { 'Content-Type': audio.mimeType, 'Cache-Control': 'no-store' } });
});
speechApi.post('/transcribe', async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length || bytes.length > 25_000_000) return c.json({ error: 'audio required (max 25 MB)' }, 400);
  const mimeType = c.req.header('content-type') ?? 'audio/webm';
  return c.json({ text: await local.transcribe!({ bytes, mimeType, name: 'voice' }, c.req.raw.signal) });
});
speechApi.onError((e, c) => c.json({ error: e.message }, (e as { statusCode?: number }).statusCode === 400 ? 400 : 500));
