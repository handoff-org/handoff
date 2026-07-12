/**
 * Fetch with retry + exponential backoff on 5xx / transient server errors.
 * Shared by the research API clients (OpenAlex, Zotero, OpenReview) that hit
 * fixed, trusted hosts — so, unlike src/tools/ssrf.ts `safeFetch`, they don't
 * need the SSRF guard and can follow redirects normally. 4xx responses are
 * returned immediately (a client error won't improve on retry). Throws once the
 * attempts are exhausted on repeated 5xx.
 */
export async function retryFetch(
  url: string,
  init: RequestInit = {},
  attempts = 3,
): Promise<Response> {
  let lastStatus = 0;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 500 * 2 ** (i - 1)));
    const res = await fetch(url, init);
    if (res.ok || res.status < 500) return res;
    lastStatus = res.status;
  }
  throw new Error(`Request failed after ${attempts} attempts (HTTP ${lastStatus})`);
}
