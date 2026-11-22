import { db } from './db.js';

/** Languages the person can pick for replies. 'auto' = answer in the language of their message. */
export const LANGUAGES = ['English', 'Hindi', 'Hinglish', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Dutch', 'Russian', 'Turkish', 'Arabic', 'Bengali', 'Urdu', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Indonesian', 'Japanese', 'Korean', 'Chinese'] as const;

export const getLanguage = (): string => (db.prepare("SELECT value FROM kv WHERE key='language'").get() as { value: string } | undefined)?.value ?? 'auto';
export const setLanguage = (v: string) => db.prepare("INSERT OR REPLACE INTO kv(key,value) VALUES ('language',?)").run(v);

export function languageRule(): string {
  const l = getLanguage();
  if (l !== 'auto') return `Always reply in ${l}${l === 'Hinglish' ? ' (Hindi written ONLY in Latin letters, never Devanagari)' : ''}, whatever language the person writes in.`;
  return 'Reply in the language and script the person writes in. If their message has Hindi words in Latin letters (e.g. "kya kar rahe ho", "mujhe batao"), that is Hinglish: answer in Hinglish using ONLY Latin letters. Never use Devanagari (हिंदी) unless their own message contains Devanagari. English in, English out.';
}

/** Settings > General > Memory: off = bots neither get their notes in the prompt nor save or search them. */
export const memoryOn = (): boolean => (db.prepare("SELECT value FROM kv WHERE key='memory_on'").get() as { value: string } | undefined)?.value !== '0';
export const setMemoryOn = (on: boolean) => db.prepare("INSERT OR REPLACE INTO kv(key,value) VALUES ('memory_on',?)").run(on ? '1' : '0');
