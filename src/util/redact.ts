/**
 * Mask secret-looking values before showing or persisting text (tool args, git
 * output, error messages, session data). Covers, in order:
 *  1. JSON/assignment pairs whose key looks like a credential.
 *  2. Credentials embedded in a URL — `//user:pass@host` or `//user@host`.
 *  3. Authorization / Bearer headers.
 *  4. Bare provider tokens: HuggingFace (`hf_…`), OpenAI (`sk-…`),
 *     GitHub (`ghp_/gho_/ghs_/ghr_/ghu_…`), AWS access-key ids (`AKIA…`).
 * All passes are safe on ordinary prose and idempotent.
 */
export function redactSecrets(s: string): string {
  return (
    s
      .replace(/("?(?:token|password|secret|api[_-]?key)"?\s*[:=]\s*")([^"]+)(")/gi, '$1•••$3')
      .replace(/(\/\/)[^/@\s:]+(?::[^/@\s]+)?@/g, '$1•••@')
      .replace(/(authorization"?\s*[:=]\s*"?\s*(?:bearer\s+)?)[A-Za-z0-9._~+/=-]+/gi, '$1•••')
      .replace(/\bhf_[A-Za-z0-9]{8,}\b/g, '•••')
      // OpenAI keys: sk-…, sk-proj-…, sk-svcacct-… (alphanumeric + -/_ , 20+ chars).
      .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '•••')
      // GitHub tokens: personal (ghp), oauth (gho), server (ghs), refresh (ghr), user (ghu).
      .replace(/\bgh[posru]_[A-Za-z0-9]{20,}\b/g, '•••')
      // AWS access-key id.
      .replace(/\bAKIA[0-9A-Z]{16}\b/g, '•••')
  );
}
