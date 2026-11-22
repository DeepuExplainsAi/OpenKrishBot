import dns from 'node:dns/promises';
import net from 'node:net';

/** True for addresses a public web page has no business reaching: loopback, private, link-local (cloud metadata), CGNAT, multicast, unspecified. */
export function isPrivateIp(ip: string): boolean {
  if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::' || l === '::1' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith('ff');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Throws unless `url` is http(s) and its host resolves only to public addresses. OPENKRISHBOT_ALLOW_PRIVATE_FETCH=1 turns the check off. */
export async function assertPublicUrl(url: string): Promise<void> {
  if (process.env.OPENKRISHBOT_ALLOW_PRIVATE_FETCH === '1') return;
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Only http(s) pages can be read, not ${u.protocol}`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(isPrivateIp)) throw new Error(`Blocked: ${u.hostname} is a private or local address. Use the browser tools for local pages.`);
}
