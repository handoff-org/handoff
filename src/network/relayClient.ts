import type { Config } from '../../config/schema.js';

export interface CreditBalance {
  balance: number;
  earned: number;
  spent: number;
}

/**
 * Register a new account on the relay. No auth required — the relay generates a
 * fresh token and returns it with the signup credit balance. Call this once to
 * self-register without needing a web dashboard.
 */
export async function registerAccount(
  relayUrl: string,
): Promise<{ token: string; balance: number } | null> {
  try {
    const res = await fetch(`${relayUrl}/register`, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as { token: string; balance: number };
  } catch {
    return null;
  }
}

/** Fetch the user's credit balance from the relay. Returns null on any error. */
export async function fetchCredits(config: Config): Promise<CreditBalance | null> {
  if (!config.peerNetworkEnabled || !config.peerToken) return null;
  try {
    const res = await fetch(`${config.peerRelayUrl}/credits`, {
      headers: { Authorization: `Bearer ${config.peerToken}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as CreditBalance;
  } catch {
    return null;
  }
}

/**
 * Post a 1–5 rating for the most recent peer inference job.
 * jobId comes from the X-Handoff-Job-Id response header set by the relay.
 */
export async function rateJob(
  config: Config,
  jobId: string,
  rating: 1 | 2 | 3 | 4 | 5,
): Promise<void> {
  if (!config.peerToken) return;
  try {
    await fetch(`${config.peerRelayUrl}/rating`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.peerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jobId, rating }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Best-effort; ratings are optional.
  }
}
