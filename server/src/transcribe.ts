import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Local speech-to-text for recordings (meetings, calls, voice notes): faster-whisper in its own venv, no key, nothing leaves the computer. */

const PY = `import json, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel
src, model, lang = sys.argv[1], sys.argv[2], sys.argv[3] or None
raw = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], check=True, capture_output=True).stdout
audio = np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
if len(audio) < 4800:
    raise SystemExit("The recording has no audio.")
segs, info = WhisperModel(model, device="cpu", compute_type="int8").transcribe(audio, language=lang, vad_filter=True, beam_size=5)
out = [{"start": round(s.start, 1), "end": round(s.end, 1), "text": s.text.strip()} for s in segs if s.text.strip()]
print(json.dumps({"language": info.language, "duration": round(len(audio) / 16000, 1), "segments": out}))
`;

export interface Segment { start: number; end: number; text: string }
export interface Transcript { language: string; duration: number; segments: Segment[] }

export const sttHome = () => path.join(process.env.KRISH_STT_HOME || path.join(os.homedir(), '.openkrishbot'), 'stt');
const venvPython = () => path.join(sttHome(), 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

export const stamp = (sec: number) => {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export const transcriptText = (t: Transcript) => t.segments.map((s) => `[${stamp(s.start)}] ${s.text}`).join('\n');

function run(cmd: string, args: string[], timeoutSec: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const e = err as any;
      if (e.code === 'ENOENT') return reject(new Error(`${cmd} is not installed or not on PATH`));
      reject(new Error(e.killed ? `${cmd} timed out after ${timeoutSec}s` : String(stderr || e.message).trim().split('\n').slice(-3).join(' | ')));
    });
  });
}

/** Creates the venv and installs faster-whisper once. KRISH_STT_PYTHON overrides the interpreter (tests, custom installs). */
async function ensureInstalled(): Promise<string> {
  const override = process.env.KRISH_STT_PYTHON;
  if (override) return override;
  const py = venvPython();
  const ok = () => run(py, ['-c', 'import faster_whisper, numpy'], 60).then(() => true, () => false);
  if (fs.existsSync(py) && (await ok())) return py;
  fs.mkdirSync(sttHome(), { recursive: true });
  const base = process.platform === 'win32' ? 'python' : 'python3';
  await run(base, ['-m', 'venv', path.join(sttHome(), 'venv')], 120);
  await run(py, ['-m', 'pip', 'install', '-q', 'faster-whisper', 'numpy'], 900);
  return py;
}

export async function transcribeFile(file: string, opts: { model?: string; language?: string } = {}): Promise<Transcript> {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  const py = await ensureInstalled();
  const script = path.join(sttHome(), 'transcribe.py');
  fs.mkdirSync(sttHome(), { recursive: true });
  fs.writeFileSync(script, PY);
  const out = await run(py, [script, file, opts.model || process.env.KRISH_WHISPER_MODEL || 'base', opts.language ?? ''], 3600);
  const json = out.trim().split('\n').pop() ?? '';
  try { return JSON.parse(json) as Transcript; } catch { throw new Error(`Transcription gave no result: ${out.slice(-200)}`); }
}
