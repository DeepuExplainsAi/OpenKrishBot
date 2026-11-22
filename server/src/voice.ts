// Voice runs in the browser (free speech recognition + synthesis). The server only lists languages and speeds.
import { Hono } from 'hono';
import type { AuthVars } from './lib/auth.js';

export const voiceApi = new Hono<AuthVars>();

export const LANGUAGES = [
  ['auto', 'Auto-detect'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-IN', 'English (India)'], ['hi-IN', 'Hindi'],
  ['bn-IN', 'Bengali'], ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['mr-IN', 'Marathi'], ['gu-IN', 'Gujarati'], ['ar-SA', 'Arabic'],
  ['zh-CN', 'Chinese'], ['fr-FR', 'French'], ['de-DE', 'German'], ['id-ID', 'Indonesian'], ['it-IT', 'Italian'], ['ja-JP', 'Japanese'],
  ['ko-KR', 'Korean'], ['pt-BR', 'Portuguese (Brazil)'], ['ru-RU', 'Russian'], ['es-ES', 'Spanish'], ['tr-TR', 'Turkish'], ['vi-VN', 'Vietnamese'],
].map(([code, name]) => ({ code, name }));

export const SPEEDS = [0.7, 0.85, 1, 1.15, 1.3, 1.5];

voiceApi.get('/options', (c) => c.json({ languages: LANGUAGES, speeds: SPEEDS }));
