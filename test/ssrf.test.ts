import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFetchUrl, normalizeIpv4 } from '../src/tools/ssrf.js';

// A blocked URL returns a non-null error string; a safe URL returns null.
const blocked = (url: string) => assert.ok(checkFetchUrl(url) !== null, `expected BLOCK: ${url}`);
const allowed = (url: string) => assert.equal(checkFetchUrl(url), null, `expected ALLOW: ${url}`);

test('non-http(s) protocols are refused', () => {
  blocked('file:///etc/passwd');
  blocked('gopher://example.com/');
  blocked('ftp://example.com/');
});

test('invalid URLs are refused', () => {
  blocked('not a url');
  blocked('http://');
});

test('loopback is blocked in all forms', () => {
  blocked('http://localhost/');
  blocked('http://localhost:8080/admin');
  blocked('http://foo.localhost/');
  blocked('http://127.0.0.1/');
  blocked('http://127.0.0.2/');
  blocked('http://127.255.255.255/');
  blocked('http://0.0.0.0/');
});

test('private IPv4 ranges are blocked', () => {
  blocked('http://10.0.0.1/');
  blocked('http://10.255.255.255/');
  blocked('http://172.16.0.1/');
  blocked('http://172.31.255.255/');
  blocked('http://192.168.0.1/');
  blocked('http://192.168.1.1/');
});

test('CGNAT 100.64/10 is blocked', () => {
  blocked('http://100.64.0.1/');
  blocked('http://100.127.255.255/');
});

test('link-local and cloud metadata are blocked', () => {
  blocked('http://169.254.169.254/latest/meta-data/');
  blocked('http://169.254.0.1/');
  blocked('http://metadata.google.internal/');
});

test('IPv6 loopback / private / link-local are blocked', () => {
  blocked('http://[::1]/');
  blocked('http://[::]/');
  blocked('http://[fe80::1]/');
  blocked('http://[fc00::1]/');
  blocked('http://[fd12:3456::1]/');
  blocked('http://[::ffff:127.0.0.1]/');
  blocked('http://[::ffff:169.254.169.254]/');
});

test('obfuscated integer IPs resolving to loopback are blocked', () => {
  blocked('http://2130706433/'); // decimal 127.0.0.1
  blocked('http://0177.0.0.1/'); // octal first octet
  blocked('http://0x7f.0.0.1/'); // hex first octet
  blocked('http://0x7f000001/'); // full hex 127.0.0.1
});

test('obfuscated integer IPs resolving to private ranges are blocked', () => {
  blocked('http://3232235521/'); // decimal 192.168.0.1
  blocked('http://167772161/'); // decimal 10.0.0.1
});

test('public hosts and IPs are allowed', () => {
  allowed('http://example.com/');
  allowed('https://example.com/path?q=1');
  allowed('http://1.1.1.1/');
  allowed('https://8.8.8.8/');
  allowed('http://93.184.216.34/'); // example.com
  allowed('https://[2606:4700:4700::1111]/'); // Cloudflare IPv6, routable
});

test('normalizeIpv4 decodes obfuscated forms', () => {
  assert.equal(normalizeIpv4('2130706433'), '127.0.0.1');
  assert.equal(normalizeIpv4('0x7f000001'), '127.0.0.1');
  assert.equal(normalizeIpv4('0177.0.0.1'), '127.0.0.1');
  assert.equal(normalizeIpv4('3232235521'), '192.168.0.1');
  assert.equal(normalizeIpv4('example.com'), null);
  assert.equal(normalizeIpv4('::1'), null);
});
