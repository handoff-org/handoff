import { readClaims, updateClaim, type ClaimLocation } from './claims.js';
import { readCapsule } from './capsule.js';

// Provenance checking: does the number written in the paper still match the run
// that produced it? For every claim linked to a run, we extract the numbers from
// the claim text and compare them against that run's *current* capsule metrics.
// The compute here is pure/deterministic; only applyProvenanceVerdicts mutates
// (marking mismatches 'outdated'), so the core is fully unit-testable.

/**
 * Numbers mentioned in a claim's text. Skips 4-digit years (1900–2099) so
 * "in 2021 we…" isn't treated as a metric, and ignores numbers glued to a word
 * or version (`v0.92`, `F1`) via the leading boundary.
 */
export function extractNumbers(text: string): { raw: string; value: number }[] {
  const out: { raw: string; value: number }[] = [];
  for (const m of text.matchAll(/(?<![\w.])-?\d+(?:\.\d+)?/g)) {
    const raw = m[0]!;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (/^\d{4}$/.test(raw) && value >= 1900 && value <= 2099) continue; // year
    out.push({ raw, value });
  }
  return out;
}

/**
 * Whether a number written in the paper matches a metric a run reported, within
 * a relative tolerance. Percent-aware: both `claimValue` and `claimValue/100`
 * are tested, so "92%", "92", and "0.92" all match a stored 0.92. Biased toward
 * matching (favor false negatives over false "stale" flags).
 */
export function numbersMatch(claimValue: number, runValue: number, relTol = 0.01): boolean {
  const scale = Math.max(Math.abs(runValue), 1e-9);
  return [claimValue, claimValue / 100].some((c) => Math.abs(c - runValue) <= relTol * scale);
}

export type ProvenanceStatus = 'current' | 'stale' | 'no_numbers' | 'no_metrics';

export interface ClaimVerdict {
  claimId: string;
  text: string;
  location: ClaimLocation | null;
  status: ProvenanceStatus;
  claimNumbers: number[];
  runIds: string[];
  /** For a stale verdict: the linked-run metric closest to the claim's numbers. */
  nearest: { metric: string; value: number } | null;
}

/**
 * Verify every run-linked claim in a project against its run's current metrics.
 * Read-only — returns a verdict per run-linked claim (claims with no run
 * evidence are skipped entirely). `applyProvenanceVerdicts` does any mutation.
 */
export function checkProvenance(slug: string): ClaimVerdict[] {
  const verdicts: ClaimVerdict[] = [];
  for (const c of readClaims(slug)) {
    const runIds = c.evidence.filter((e) => e.kind === 'run').map((e) => e.ref);
    if (runIds.length === 0) continue; // only verify run-backed claims

    const metrics: { metric: string; value: number; runId: string }[] = [];
    for (const rid of runIds) {
      const cap = readCapsule(slug, rid);
      if (cap)
        for (const [k, v] of Object.entries(cap.metrics))
          metrics.push({ metric: k, value: v, runId: rid });
    }
    const nums = extractNumbers(c.text).map((n) => n.value);
    const base = {
      claimId: c.id,
      text: c.text,
      location: c.locations[0] ?? null,
      claimNumbers: nums,
      runIds,
    };

    if (metrics.length === 0) {
      verdicts.push({ ...base, status: 'no_metrics', nearest: null });
      continue;
    }
    if (nums.length === 0) {
      verdicts.push({ ...base, status: 'no_numbers', nearest: null });
      continue;
    }
    if (nums.some((n) => metrics.some((m) => numbersMatch(n, m.value)))) {
      verdicts.push({ ...base, status: 'current', nearest: null });
      continue;
    }
    // Stale: report the metric closest to any claim number (percent-aware).
    let nearest = metrics[0]!;
    let best = Infinity;
    for (const m of metrics) {
      for (const n of nums) {
        for (const cand of [n, n / 100]) {
          const d = Math.abs(cand - m.value);
          if (d < best) {
            best = d;
            nearest = m;
          }
        }
      }
    }
    verdicts.push({
      ...base,
      status: 'stale',
      nearest: { metric: nearest.metric, value: nearest.value },
    });
  }
  return verdicts;
}

function staleNote(v: ClaimVerdict): string {
  const runs = v.runIds.join('/');
  const metric = v.nearest ? `${v.nearest.metric}=${v.nearest.value}` : 'no recorded metric';
  return `Paper says ${v.claimNumbers.join(', ')}; linked run ${runs} reports ${metric}.`;
}

/**
 * Apply verdicts: mark `stale` claims `outdated` (with a concrete risk note),
 * and recover a previously-`outdated` claim back to `weakly_supported` when its
 * number now matches. Returns transition counts. The only side-effecting entry.
 */
export function applyProvenanceVerdicts(
  slug: string,
  verdicts: ClaimVerdict[],
): { markedOutdated: number; recovered: number } {
  let markedOutdated = 0;
  let recovered = 0;
  const byId = new Map(readClaims(slug).map((c) => [c.id, c]));
  for (const v of verdicts) {
    const claim = byId.get(v.claimId);
    if (!claim) continue;
    if (v.status === 'stale') {
      const wasOutdated = claim.status === 'outdated';
      updateClaim(slug, v.claimId, { status: 'outdated', risks: [staleNote(v)] });
      if (!wasOutdated) markedOutdated++;
    } else if (v.status === 'current' && claim.status === 'outdated') {
      updateClaim(slug, v.claimId, { status: 'weakly_supported', risks: [] });
      recovered++;
    }
  }
  return { markedOutdated, recovered };
}

const trunc = (s: string): string => (s.length > 70 ? s.slice(0, 70) + '…' : s);

/** A scannable provenance report for the transcript. */
export function formatProvenanceReport(verdicts: ClaimVerdict[], projectTitle: string): string {
  const lines: string[] = [`Provenance — ${projectTitle}`, ''];
  if (verdicts.length === 0) {
    lines.push(
      'No run-linked claims to verify. Link a claim to its run with',
      '/claim-link-run <claim_id> <run_id>, then run /provenance.',
    );
    return lines.join('\n');
  }

  const stale = verdicts.filter((v) => v.status === 'stale');
  const current = verdicts.filter((v) => v.status === 'current');
  const noNums = verdicts.filter((v) => v.status === 'no_numbers');
  const noMetrics = verdicts.filter((v) => v.status === 'no_metrics');

  if (stale.length) {
    lines.push(`⚠ ${stale.length} stale (paper number no longer matches its run):`);
    for (const v of stale) {
      const loc = v.location ? `${v.location.path}:${v.location.start_line}` : '—';
      const metric = v.nearest ? `${v.nearest.metric}=${v.nearest.value}` : 'no metric';
      lines.push(`  ↩ ${v.claimId}  ${loc}`);
      lines.push(
        `     paper: ${v.claimNumbers.join(', ')}  →  run ${v.runIds.join('/')}: ${metric}`,
      );
      lines.push(`     "${trunc(v.text)}"`);
    }
    lines.push('');
  }
  if (current.length) lines.push(`✓ ${current.length} current — numbers match their run.`);
  if (noNums.length)
    lines.push(`· ${noNums.length} run-linked claim(s) with no numeric value to check.`);
  if (noMetrics.length)
    lines.push(`· ${noMetrics.length} claim(s) whose linked run has no recorded metrics.`);
  lines.push('');
  lines.push(
    stale.length
      ? 'Stale claims were marked "outdated". Fix the paper number (or re-link the run), then run /provenance again.'
      : 'All run-linked numbers are current.',
  );
  return lines.join('\n');
}
