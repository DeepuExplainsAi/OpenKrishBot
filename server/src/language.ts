import { db } from './db.js';

/** Languages the person can pick for replies. 'auto' = answer in the language of their message. */
export const LANGUAGES = ['English', 'Hindi', 'Hinglish', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Dutch', 'Russian', 'Turkish', 'Arabic', 'Bengali', 'Urdu', 'Tamil', 'Telugu', 'Marathi', 'Gujarati', 'Indonesian', 'Japanese', 'Korean', 'Chinese'] as const;

export const getLanguage = (): string => (db.prepare("SELECT value FROM kv WHERE key='language'").get() as { value: string } | undefined)?.value ?? 'auto';
export const setLanguage = (v: string) => db.prepare("INSERT OR REPLACE INTO kv(key,value) VALUES ('language',?)").run(v);

export function languageRule(): string {
  const l = getLanguage();
  if (l !== 'auto') return `Always reply in ${l}${l === 'Hinglish' ? ' (Hindi written in the Latin alphabet)' : ''}, whatever language the person writes in.`;
  return 'Reply in the language the person writes in, in the same script: if they write Hinglish (Hindi in Latin letters), answer in Hinglish, never in Devanagari; if they write English, answer in English.';
}
