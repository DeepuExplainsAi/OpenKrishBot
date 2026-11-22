// Free voice with no server and no key: the browser's own speech recognition (input) and speech synthesis (output).

export const SpeechRec: any = typeof window === 'undefined' ? null : (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
export const speechSupported = !!SpeechRec;

export const UNSUPPORTED = 'Voice input needs Chrome, Edge or Safari.';

export function micErrorMessage(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone access was blocked. Allow it in your browser’s site settings.';
  if (code === 'audio-capture') return 'No microphone found.';
  if (code === 'network') return 'Speech recognition needs an internet connection in this browser.';
  return 'Could not use the microphone.';
}

export const recLang = (language?: string) => (!language || language === 'auto' ? navigator.language || 'en-US' : language);

export function listVoices(): Promise<SpeechSynthesisVoice[]> {
  const s = window.speechSynthesis;
  if (!s) return Promise.resolve([]);
  const now = s.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((res) => {
    const done = () => res(s.getVoices());
    s.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

/** Markdown and links are noise when read aloud. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code block. ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[*_`#>~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(voices: SpeechSynthesisVoice[], voice: string | undefined, lang: string) {
  return voices.find((v) => v.voiceURI === voice || v.name === voice)
    ?? voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase() && v.localService === false)
    ?? voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
}

/** Speak text; resolves when finished or cancelled. Long text is spoken sentence group by group (Chrome stops long utterances). */
export async function speak(text: string, o: { voice?: string; speed?: number; language?: string }, signal?: AbortSignal): Promise<void> {
  const s = window.speechSynthesis;
  if (!s) throw new Error('This browser can’t speak aloud.');
  const lang = recLang(o.language);
  const voice = pick(await listVoices(), o.voice, lang);
  const parts = speakable(text).match(/[^.!?।\n]+[.!?।]*\s*/g)?.reduce<string[]>((a, p) => {
    if (a.length && a[a.length - 1].length + p.length < 220) a[a.length - 1] += p; else a.push(p);
    return a;
  }, []) ?? [];
  for (const part of parts) {
    if (signal?.aborted) break;
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = voice?.lang ?? lang;
      if (voice) u.voice = voice;
      u.rate = o.speed ?? 1;
      u.onend = u.onerror = () => resolve();
      signal?.addEventListener('abort', () => { s.cancel(); resolve(); }, { once: true });
      s.speak(u);
    });
  }
}
