import type { ToolRegistry } from '../tools/registry.js';
import { loadConfig } from '../../config/schema.js';
import { retryFetch } from '../util/http.js';

/**
 * OpenReview connector: fetch the user's paper submissions and their reviewer
 * feedback (reviews, official comments, meta-reviews, decisions) so the agent
 * can summarize them and — on request — help draft point-by-point responses.
 * Read-only: nothing is ever posted back to OpenReview.
 *
 * Uses the API v2 REST endpoints (https://api2.openreview.net): POST /login for
 * a bearer token, GET /notes?content.authorids=<profile> for your submissions,
 * and GET /notes?forum=<id> for a submission's replies. Content in v2 is nested
 * as note.content.<field>.value; note type is read from the `invitations` array.
 * Credentials come from config (captured by the /openreview link form, never
 * through the model). Pure parsing helpers are exported for unit tests.
 */

const OPENREVIEW_API = 'https://api2.openreview.net';
const NOT_LINKED =
  'OpenReview is not linked. Run /openreview to connect (your OpenReview email/username and password).';

// ── Credentials ─────────────────────────────────────────────────────────────

export interface OpenReviewCreds {
  username: string;
  password: string;
}

export async function openreviewCreds(): Promise<OpenReviewCreds | null> {
  const cfg = await loadConfig();
  if (cfg.openreviewUsername && cfg.openreviewPassword) {
    return { username: cfg.openreviewUsername, password: cfg.openreviewPassword };
  }
  return null;
}

// ── Raw shapes + pure helpers (unit-tested; no network) ──────────────────────

export interface RawNote {
  id?: string;
  forum?: string;
  number?: number;
  invitations?: string[];
  invitation?: string; // v1 fallback
  signatures?: string[];
  content?: Record<string, unknown>;
}

/** Read a v2 content field (`{value: …}`), falling back to a bare value (v1). */
export function fieldValue(content: Record<string, unknown> | undefined, key: string): string {
  if (!content) return '';
  const raw = content[key];
  const v =
    raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)
      ? (raw as { value?: unknown }).value
      : raw;
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  return String(v);
}

/** All non-empty content fields flattened to strings (schema-agnostic). */
export function flattenContent(
  content: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!content) return out;
  for (const k of Object.keys(content)) {
    const v = fieldValue(content, k);
    if (v) out[k] = v;
  }
  return out;
}

/** The invitation ids on a note (v2 `invitations` array, or v1 `invitation`). */
export function noteInvitations(n: RawNote): string[] {
  if (Array.isArray(n.invitations)) return n.invitations;
  if (n.invitation) return [n.invitation];
  return [];
}

export type ReplyKind = 'meta-review' | 'decision' | 'review' | 'rebuttal' | 'comment' | 'other';

/** Classify a forum note from its invitation id suffix. */
export function classifyReply(n: RawNote): ReplyKind {
  const invs = noteInvitations(n).join(' ').toLowerCase();
  if (/meta[_-]?review/.test(invs)) return 'meta-review';
  if (/decision/.test(invs)) return 'decision';
  if (/rebuttal|author[_-]?response/.test(invs)) return 'rebuttal';
  if (/review/.test(invs)) return 'review';
  if (/comment/.test(invs)) return 'comment';
  return 'other';
}

export interface Submission {
  id: string;
  forum: string;
  number?: number;
  title: string;
  venue: string;
}

/** Parse a /notes response into submission summaries. */
export function parseSubmissions(json: unknown): Submission[] {
  const notes = (json as { notes?: RawNote[] })?.notes ?? [];
  return notes
    .map((n) => ({
      id: String(n.id ?? ''),
      forum: String(n.forum ?? n.id ?? ''),
      number: typeof n.number === 'number' ? n.number : undefined,
      title: fieldValue(n.content, 'title') || '(untitled)',
      venue: fieldValue(n.content, 'venue') || fieldValue(n.content, 'venueid'),
    }))
    .filter((s) => s.id);
}

export interface Reply {
  kind: ReplyKind;
  signatures: string;
  content: Record<string, string>;
}

/** Parse a forum's /notes response into typed replies (excludes the submission itself). */
export function parseReplies(json: unknown, forumId: string): Reply[] {
  const notes = (json as { notes?: RawNote[] })?.notes ?? [];
  return notes
    .filter((n) => String(n.id ?? '') !== forumId)
    .map((n) => ({
      kind: classifyReply(n),
      signatures: (n.signatures ?? []).join(', '),
      content: flattenContent(n.content),
    }))
    .filter((r) => r.kind !== 'other');
}

const KIND_LABEL: Record<ReplyKind, string> = {
  'meta-review': 'Meta-review',
  decision: 'Decision',
  review: 'Review',
  rebuttal: 'Author response',
  comment: 'Comment',
  other: 'Other',
};
const KIND_ORDER: ReplyKind[] = ['decision', 'meta-review', 'review', 'rebuttal', 'comment'];

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** Render replies as readable, grouped Markdown for the model to reason over. */
export function formatReplies(replies: Reply[], sub?: Submission): string {
  const lines: string[] = [];
  if (sub) {
    lines.push(
      `# ${sub.title}${sub.number ? ` (#${sub.number})` : ''}${sub.venue ? ` — ${sub.venue}` : ''}\n`,
    );
  }
  if (!replies.length) {
    lines.push('No reviews, comments, or decisions found for this submission yet.');
    return lines.join('\n').trim();
  }
  for (const kind of KIND_ORDER) {
    const group = replies.filter((r) => r.kind === kind);
    group.forEach((r, i) => {
      lines.push(`## ${KIND_LABEL[kind]}${group.length > 1 ? ` ${i + 1}` : ''} — ${r.signatures}`);
      for (const [k, v] of Object.entries(r.content)) {
        if (k === 'title') continue;
        lines.push(`- **${k}**: ${truncate(v, 800)}`);
      }
      lines.push('');
    });
  }
  return lines.join('\n').trim();
}

// ── Network ──────────────────────────────────────────────────────────────────

interface LoginResult {
  token: string;
  profileId: string;
}

/** Authenticate and return a bearer token + the user's tilde profile id. */
export async function login(creds: OpenReviewCreds): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetch(`${OPENREVIEW_API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: creds.username, password: creds.password }),
    });
  } catch (err) {
    throw new Error(`Cannot reach OpenReview: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) {
      throw new Error('OpenReview login failed — check your username and password (/openreview).');
    }
    throw new Error(`OpenReview login failed (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as {
    token?: string;
    user?: { id?: string; profile?: { id?: string } };
  };
  if (!data.token) throw new Error('OpenReview login returned no token.');
  // profile.id is the ~Tilde_Id that content.authorids is matched against; user.id
  // is the account/email. Prefer the profile id (matches the official client).
  return { token: data.token, profileId: data.user?.profile?.id ?? data.user?.id ?? '' };
}

/** Authenticated GET with retry/backoff on 5xx. */
async function orFetch(path: string, token: string): Promise<Response> {
  return retryFetch(`${OPENREVIEW_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── Tools ────────────────────────────────────────────────────────────────────

export function registerOpenReviewTools(registry: ToolRegistry): void {
  // ── openreview_my_submissions ──────────────────────────────────────────────
  registry.register({
    name: 'openreview_my_submissions',
    description:
      'List the OpenReview submissions where the linked user is an author. Returns each ' +
      "submission's forum id, title, and venue — use the forum id with openreview_reviews. " +
      'Requires a linked OpenReview account (/openreview).',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const creds = await openreviewCreds();
      if (!creds) return NOT_LINKED;
      try {
        const { token, profileId } = await login(creds);
        if (!profileId) {
          return 'Logged in, but could not determine your profile id. Try again, or set your ~profile id as the username.';
        }
        const res = await orFetch(
          `/notes?content.authorids=${encodeURIComponent(profileId)}&limit=50`,
          token,
        );
        if (!res.ok) return `OpenReview error (HTTP ${res.status}).`;
        const subs = parseSubmissions(await res.json());
        if (!subs.length) {
          return `No submissions found for ${profileId}. (Blind or withdrawn papers may not be listed, and very new venues can lag.)`;
        }
        return subs
          .map(
            (s) =>
              `[${s.forum}] ${s.title}${s.number ? ` (#${s.number})` : ''}${
                s.venue ? ` — ${s.venue}` : ''
              }`,
          )
          .join('\n');
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
  });

  // ── openreview_reviews ─────────────────────────────────────────────────────
  registry.register({
    name: 'openreview_reviews',
    description:
      'Fetch all reviewer feedback for one submission — reviews, official comments, the ' +
      'meta-review, and the decision — as readable text. Pass the submission forum id from ' +
      'openreview_my_submissions. Read-only; nothing is posted back.',
    parameters: {
      type: 'object',
      properties: {
        forum: {
          type: 'string',
          description: 'Submission forum id (from openreview_my_submissions)',
        },
      },
      required: ['forum'],
    },
    async execute({ forum }) {
      const creds = await openreviewCreds();
      if (!creds) return NOT_LINKED;
      const f = String(forum ?? '').trim();
      if (!f) return 'Provide the submission forum id (from openreview_my_submissions).';
      try {
        const { token } = await login(creds);
        const res = await orFetch(`/notes?forum=${encodeURIComponent(f)}&limit=200`, token);
        if (!res.ok) return `OpenReview error (HTTP ${res.status}).`;
        const json = await res.json();
        const notes = (json as { notes?: RawNote[] }).notes ?? [];
        const subNote = notes.find((n) => String(n.id ?? '') === f);
        const sub = subNote ? parseSubmissions({ notes: [subNote] })[0] : undefined;
        return formatReplies(parseReplies(json, f), sub);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
  });
}
