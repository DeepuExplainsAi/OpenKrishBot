import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Commands that can destroy data or leak the machine. These ask every time, even after "Always allow". */
const RULES: [RegExp, string][] = [
  [/\brm\s+(-[a-z]*[rf][a-z]*\s+)+(\/|~|\$HOME|\*)(\s|$)/i, 'deletes everything under a top-level folder'],
  [/\b(mkfs|dd\s+if=|fdisk|wipefs)\b/i, 'writes to a disk directly'],
  [/\b(curl|wget)\b[^|;]*\|\s*(sudo\s+)?(sh|bash|zsh|python3?)\b/i, 'runs a downloaded script'],
  [/\bchmod\s+-R\s+7?77\b/i, 'opens permissions on a whole tree'],
  [/\bgit\s+push\b[^;&|]*(--force|\s-f\b)/i, 'force-pushes git history'],
  [/\b(shutdown|reboot|halt|poweroff)\b/i, 'turns off the computer'],
  [/:\(\)\s*\{.*\};\s*:/, 'fork bomb'],
  [/(\.ssh\/|\.aws\/credentials|\.krishbot\/(providers|whatsapp))/i, 'touches stored keys or logins'],
];

export function dangerReason(tool: string, args: any): string | null {
  const text = tool === 'terminal' ? String(args?.command ?? '')
    : tool === 'execute_code' ? String(args?.code ?? '')
    : ['write_file', 'patch', 'read_file'].includes(tool) ? String(args?.path ?? '') : '';
  for (const [re, why] of RULES) if (re.test(text)) return why;
  return null;
}

const SECRETS: RegExp[] = [
  /\b(sk|gsk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
];

/** Keep keys out of the transcript and the model's context. */
export function redact(text: string): string {
  return SECRETS.reduce((t, re) => t.replace(re, '[secret hidden]'), text);
}

const auditFile = path.join(os.homedir(), '.krishbot', 'audit.log');

/** One JSON line per tool run, local only. Never throws. */
export function audit(entry: { bot: string; tool: string; status: string; danger?: string | null; args?: unknown }) {
  try {
    fs.mkdirSync(path.dirname(auditFile), { recursive: true });
    const args = redact(JSON.stringify(entry.args ?? {})).slice(0, 500);
    fs.appendFileSync(auditFile, JSON.stringify({ t: new Date().toISOString(), ...entry, args }) + '\n');
  } catch { /* audit must never break a run */ }
}
