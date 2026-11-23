import nodePath from 'node:path';
import os from 'node:os';

// Copied from n8n-io/nod server/local-files.ts (Apache-2.0): which files a Bot must never read on its own.
// Only the pure rules; nod's Postgres-backed file actions are not used here.
const secretNames = [
  /\.(pem|p12|pfx|ppk|kdbx|kdb|keychain|keychain-db|ovpn|gpg|asc|tfstate|1pux|1pif|env)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /^wallet\.dat$/i,
  /^ntuser\.dat/i,
  /credentials.*\.csv$/i,
  /^service-account.*\.json$/i,
  /^bitwarden_export/i,
];
const home = os.homedir();
const botSpace = nodePath.join(home, '.openkrishbot');

/** True for secret files (private keys, wallets, password stores, cloud credentials) under the user's home, outside a Bot's own workspace. Only nod's secret-file names are used (not its hidden-folder rules). */
export function isSecretFile(target: string): boolean {
  const abs = nodePath.resolve(target);
  const rel = nodePath.relative(home, abs);
  if (rel.startsWith('..') || nodePath.isAbsolute(rel)) return false;
  const inBotSpace = !nodePath.relative(botSpace, abs).startsWith('..');
  return !inBotSpace && secretNames.some((p) => p.test(nodePath.basename(abs)));
}
