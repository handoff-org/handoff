import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  appendFileSync,
  copyFileSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { AdaptiveProfileSchema, defaultProfile, migrate, type AdaptiveProfile } from './profile.js';

/**
 * Persistence for the local adaptive profile. Everything is best-effort and
 * crash-safe: a corrupt profile is backed up and replaced with a fresh one
 * rather than throwing, and writes go through a temp-file + rename so a crash
 * mid-write can't truncate the file. Mirrors config/store.ts.
 */

const HANDOFF_DIR = join(homedir(), '.handoff');
export const PROFILE_PATH = join(HANDOFF_DIR, 'profile.json');
const EVENTS_PATH = join(HANDOFF_DIR, 'profile-events.jsonl');

function stamp(): string {
  return new Date().toISOString();
}

let _bakSeq = 0;
function fileStamp(): string {
  return `${stamp().replace(/[:.]/g, '-')}-${++_bakSeq}`;
}

/**
 * Load the profile. On a missing file → a fresh default (not written to disk
 * until something is learned). On corrupt/invalid JSON → move the bad file to a
 * timestamped `.bak` and return a fresh default. Never throws.
 */
export function loadProfile(): AdaptiveProfile {
  const now = stamp();
  if (!existsSync(PROFILE_PATH)) return defaultProfile(now);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(PROFILE_PATH, 'utf-8'));
  } catch {
    backupCorrupt();
    return defaultProfile(now);
  }
  const migrated = migrate(raw, now);
  if (migrated) return migrated;
  backupCorrupt();
  return defaultProfile(now);
}

function backupCorrupt(): void {
  try {
    copyFileSync(PROFILE_PATH, `${PROFILE_PATH}.${fileStamp()}.bak`);
  } catch {
    /* best-effort */
  }
}

// Serialize writes so overlapping best-effort saves never clobber each other.
let writeChain: Promise<void> = Promise.resolve();

/** Persist the profile atomically (temp file + rename). Best-effort, never throws. */
export function saveProfile(profile: AdaptiveProfile): Promise<void> {
  // Validate + stamp before writing; bail quietly if the object is malformed.
  const parsed = AdaptiveProfileSchema.safeParse({ ...profile, updatedAt: stamp() });
  if (!parsed.success) return writeChain;
  const data = JSON.stringify(parsed.data, null, 2);
  writeChain = writeChain.then(async () => {
    try {
      mkdirSync(HANDOFF_DIR, { recursive: true });
      const tmp = `${PROFILE_PATH}.${process.pid}.tmp`;
      writeFileSync(tmp, data, 'utf-8');
      renameSync(tmp, PROFILE_PATH);
    } catch {
      /* persisting the profile is best-effort */
    }
  });
  return writeChain;
}

/** Back up the current profile (if any) and return a fresh default. */
export function resetProfile(): AdaptiveProfile {
  if (existsSync(PROFILE_PATH)) {
    try {
      renameSync(PROFILE_PATH, `${PROFILE_PATH}.${fileStamp()}.bak`);
    } catch {
      /* best-effort */
    }
  }
  return defaultProfile(stamp());
}

/** Write a timestamped copy of the profile and return its path (or null). */
export function exportProfile(profile: AdaptiveProfile): string | null {
  try {
    mkdirSync(HANDOFF_DIR, { recursive: true });
    const dest = join(HANDOFF_DIR, `profile-export-${fileStamp()}.json`);
    writeFileSync(dest, JSON.stringify(profile, null, 2), 'utf-8');
    return dest;
  } catch {
    return null;
  }
}

/**
 * Append one compact, already-sanitized event line for transparency
 * (`/profile why`). Bounded by design: callers pass short summaries only.
 */
export function appendProfileEvent(entry: {
  type: string;
  timestamp: string;
  summary: string;
}): void {
  try {
    mkdirSync(HANDOFF_DIR, { recursive: true });
    appendFileSync(EVENTS_PATH, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    /* non-fatal */
  }
}
