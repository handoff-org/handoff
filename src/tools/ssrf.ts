import { isIP } from 'net';

/**
 * SSRF guard for outbound fetches (web_fetch, read_pdf). Local-first tools must
 * never be tricked into reaching the loopback interface, the LAN, or a cloud
 * metadata endpoint — those are the classic SSRF targets (credential theft via
 * 169.254.169.254, hitting internal services, port-scanning localhost).
 *
 * This blocks by IP *range* after normalizing the host, so obfuscated encodings
 * (decimal/octal/hex integer IPs, IPv4-mapped IPv6) can't slip past a
 * string-prefix check. It does NOT resolve DNS names — a hostname that resolves
 * to a private IP (DNS rebinding) is out of scope here and noted as a follow-up;
 * defending that needs resolve-then-pin at connect time.
 */

/** Parse a dotted-quad string into its 32-bit value, or null if not one. */
function dottedQuadToInt(host: string): number | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

/**
 * Normalize a URL hostname to a canonical IPv4 dotted-quad when it denotes one.
 * Handles decimal (`2130706433`), octal (`0177.0.0.1`), hex (`0x7f.0.0.1` /
 * `0x7f000001`), and already-dotted forms. Returns null when the host is not an
 * integer/obfuscated IPv4 literal (i.e. it's a name or an IPv6 literal).
 */
export function normalizeIpv4(host: string): string | null {
  const h = host.toLowerCase();

  // Single integer forms: decimal, hex (0x…), or octal (0…).
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/.test(h) || /^0[0-7]+$/.test(h)) {
    let value: number;
    try {
      if (h.startsWith('0x')) value = parseInt(h, 16);
      else if (/^0[0-7]+$/.test(h)) value = parseInt(h, 8);
      else value = parseInt(h, 10);
    } catch {
      return null;
    }
    if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) return null;
    return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
  }

  // Dotted forms where octets may be octal/hex (e.g. 0177.0.0.1, 0x7f.0.0.1).
  const parts = h.split('.');
  if (parts.length === 4) {
    const octets: number[] = [];
    for (const p of parts) {
      let n: number;
      if (/^0x[0-9a-f]+$/.test(p)) n = parseInt(p, 16);
      else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
      else if (/^\d+$/.test(p)) n = parseInt(p, 10);
      else return null;
      if (!Number.isFinite(n) || n < 0 || n > 255) return null;
      octets.push(n);
    }
    // Only treat as "obfuscated" if some octet wasn't plain decimal; plain
    // dotted-decimal is handled by isIP below without needing normalization.
    return octets.join('.');
  }

  return null;
}

/** True when a 32-bit IPv4 value falls in a blocked (private/loopback/etc.) range. */
function isBlockedIpv4(value: number): boolean {
  const a = (value >>> 24) & 255;
  const b = (value >>> 16) & 255;
  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 127 || // loopback
    a === 10 || // private
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) || // link-local (incl. cloud metadata)
    (a === 100 && b >= 64 && b <= 127) // CGNAT 100.64/10
  );
}

/** True when an IPv6 literal (already stripped of brackets) is loopback/private/link-local. */
function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::1' || h === '::') return true; // loopback / unspecified
  if (h.startsWith('fe80') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 unique-local
  // IPv4-mapped / -compatible. Node canonicalizes `::ffff:127.0.0.1` to the hex
  // form `::ffff:7f00:1`, so match both the dotted-quad tail and the hex tail
  // and re-check the embedded v4 address against the blocked ranges.
  const v4 = mappedIpv4(h);
  if (v4 !== null && isBlockedIpv4(v4)) return true;
  return false;
}

/**
 * Extract the embedded IPv4 value (as a 32-bit int) from an IPv4-mapped or
 * -compatible IPv6 address, or null if there isn't one. Handles both the
 * dotted-quad tail (`::ffff:1.2.3.4`) and the canonical hex tail (`::ffff:102:304`).
 */
function mappedIpv4(h: string): number | null {
  const dotted = h.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted && dotted[1]) return dottedQuadToInt(dotted[1]);

  const hex = h.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex && hex[1] && hex[2]) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    if (Number.isFinite(hi) && Number.isFinite(lo)) return ((hi << 16) | lo) >>> 0;
  }
  return null;
}

/**
 * Guard an outbound fetch URL. Returns an error string to show *instead* of
 * fetching, or null when the URL is safe to request.
 */
export function checkFetchUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return `Refused: not a valid URL: ${raw}`;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return `Refused: only http(s) URLs are allowed (got "${u.protocol}").`;
  }

  let host = u.hostname.toLowerCase();

  // Bare hostnames that always mean the local machine.
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return `Refused: ${host} resolves to the local machine.`;
  }
  if (host === 'metadata.google.internal') {
    return `Refused: ${host} is a cloud-metadata address.`;
  }

  // IPv6 literal: URL keeps the brackets in hostname for some inputs; strip them.
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.includes(':')) {
    if (isBlockedIpv6(host)) {
      return `Refused: ${host} is a loopback / private / link-local address.`;
    }
    return null; // a routable IPv6 literal
  }

  // IPv4 — including obfuscated decimal/octal/hex encodings.
  let value: number | null = null;
  if (isIP(host) === 4) {
    value = dottedQuadToInt(host);
  } else {
    const normalized = normalizeIpv4(host);
    if (normalized) value = dottedQuadToInt(normalized);
  }
  if (value !== null && isBlockedIpv4(value)) {
    return `Refused: ${host} is a loopback / private / link-local address.`;
  }

  return null;
}

/** Thrown by safeFetch when a URL (or a redirect hop) is refused or malformed. */
export class SsrfError extends Error {}

/**
 * Fetch a URL with the SSRF guard applied to every hop. Redirects are followed
 * manually and each Location is re-checked with checkFetchUrl, so a URL that
 * passes the initial check can't 302 to localhost / a cloud-metadata endpoint /
 * the LAN. Returns the final non-redirect Response; throws SsrfError when a hop
 * is blocked, a redirect is malformed, or the redirect limit is exceeded. Network
 * errors from fetch propagate as-is. Callers pass their own headers via `init`
 * (its `redirect` is always overridden to 'manual').
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  opts: { maxRedirects?: number } = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const bad = checkFetchUrl(current);
    if (bad) throw new SsrfError(bad);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new SsrfError(`HTTP ${res.status} with no Location header.`);
      try {
        current = new URL(loc, current).toString();
      } catch {
        throw new SsrfError(`HTTP ${res.status} with unparseable redirect: ${loc}`);
      }
      continue;
    }
    return res;
  }
  throw new SsrfError(`Refused: too many redirects (>${maxRedirects}).`);
}
