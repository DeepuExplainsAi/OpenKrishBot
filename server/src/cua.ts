import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * OS-level computer use (any window, mouse, keyboard) through trycua's cua-driver (MIT), the same driver OpenMausBot bundles.
 * The pinned release archive is downloaded once from github.com, checked against its SHA-256 and unpacked into ~/.openkrishbot/cua;
 * after that it runs as a local MCP server (`cua-driver mcp`). Nothing is hosted.
 */
const VERSION = '0.41.3';
const BASE = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${VERSION}`;
const ARCHIVES: Record<string, { file: string; sha256: string; exe: string }> = {
  'linux-x64': { file: `cua-driver-rs-${VERSION}-linux-x86_64-binary.tar.gz`, sha256: 'a00a7bc4a648adbcbc93bfbf5a058daf71ce8838ee172e33b197aaf649ecee14', exe: 'cua-driver' },
  'linux-arm64': { file: `cua-driver-rs-${VERSION}-linux-arm64-binary.tar.gz`, sha256: '9fe4b3a28eb0e1df9b48b26ba56c1c454966824bdd6e0f077d59d283d7c76cc4', exe: 'cua-driver' },
  'darwin-x64': { file: `cua-driver-rs-${VERSION}-darwin-universal-binary.tar.gz`, sha256: 'af23b26a6e2e1cd0917536244ca0050b1447f2d344c958cdb79bfb3342282268', exe: 'cua-driver' },
  'darwin-arm64': { file: `cua-driver-rs-${VERSION}-darwin-universal-binary.tar.gz`, sha256: 'af23b26a6e2e1cd0917536244ca0050b1447f2d344c958cdb79bfb3342282268', exe: 'cua-driver' },
  'win32-x64': { file: `cua-driver-rs-${VERSION}-windows-x86_64-binary.zip`, sha256: '915ebda0a94651c03d2ca24a2f0d8f12206c539375856af06939490ea7bdf5a7', exe: 'cua-driver.exe' },
  'win32-arm64': { file: `cua-driver-rs-${VERSION}-windows-arm64-binary.zip`, sha256: '5a371278823d2afa7fd9da93794edf8f6f886a4dadd0b061ec0add83ec5e0c8c', exe: 'cua-driver.exe' },
};

const run = promisify(execFile);
const dir = () => path.join(os.homedir(), '.openkrishbot', 'cua', VERSION);
const pick = () => ARCHIVES[`${process.platform}-${process.arch}`];

export const cuaSupported = () => !!pick();
export const cuaPath = () => { const a = pick(); return a ? path.join(dir(), a.exe) : undefined; };
export const cuaInstalled = () => { const p = cuaPath(); return !!p && fs.existsSync(p); };

export async function installCua(): Promise<string> {
  const a = pick();
  if (!a) throw new Error(`Computer control is not available for ${process.platform} ${process.arch}.`);
  if (cuaInstalled()) return cuaPath()!;
  const res = await fetch(`${BASE}/${a.file}`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== a.sha256) throw new Error('The downloaded driver does not match its pinned checksum; not installed.');
  const tmp = `${dir()}.part`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const archive = path.join(tmp, a.file);
  fs.writeFileSync(archive, bytes);
  // tar ships with Linux, macOS and Windows 10+ (bsdtar reads zip too).
  await run('tar', ['-xf', archive, '-C', tmp], { windowsHide: true });
  fs.rmSync(archive);
  if (process.platform !== 'win32') fs.chmodSync(path.join(tmp, a.exe), 0o755);
  fs.rmSync(dir(), { recursive: true, force: true });
  fs.renameSync(tmp, dir());
  return cuaPath()!;
}
