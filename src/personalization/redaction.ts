import { redactSecrets } from '../util/redact.js';

/**
 * The privacy gate for anything that might land in the global profile. The rule
 * is "when in doubt, don't store it": we only keep short, non-sensitive
 * preference phrases. Raw code, quoted passages, secrets, and credentials are
 * rejected outright rather than stored in a redacted form.
 */

const MAX_LEN = 200;

export type SanitizeResult = { ok: true; value: string } | { ok: false; reason: string };

/**
 * Clean and vet a candidate preference string. Returns the safe value to store,
 * or a rejection with a short reason (used for `/profile why`/debugging, never
 * shown intrusively). Deterministic.
 */
export function sanitizePreference(input: string): SanitizeResult {
  const text = input.trim();
  if (!text) return { ok: false, reason: 'empty' };

  // Reject obvious code — fenced blocks or multi-line snippets don't belong in a
  // preference profile (they're content, not preferences).
  if (text.includes('```') || /\n.*[{};]\s*$/m.test(text)) {
    return { ok: false, reason: 'looks like code' };
  }

  // Reject long passages — a preference is a short statement, not a paragraph
  // pasted from a paper or file.
  if (text.length > MAX_LEN) return { ok: false, reason: 'too long' };
  if (text.split(/\s+/).length > 40) return { ok: false, reason: 'too long' };

  // Reject URLs carrying credentials/tokens (query token or userinfo).
  if (/https?:\/\/[^\s]*[?&](?:token|key|access_token|api_key)=/i.test(text)) {
    return { ok: false, reason: 'token URL' };
  }
  if (/https?:\/\/[^/\s@]+:[^/\s@]+@/.test(text)) {
    return { ok: false, reason: 'credentialed URL' };
  }

  // If a secret pattern is present, reject rather than store a masked version —
  // we never want secret-shaped fragments in the profile at all.
  if (redactSecrets(text) !== text) {
    return { ok: false, reason: 'contains a secret' };
  }

  // Strip email addresses (PII) — replace, don't reject, since the surrounding
  // preference may still be useful.
  const cleaned = text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '‹email›');

  return { ok: true, value: cleaned };
}
