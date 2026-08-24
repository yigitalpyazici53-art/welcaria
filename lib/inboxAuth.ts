// ── Inbox session store (pilot) ───────────────────────────────────────────────
//
// Login is per-operator (see lib/inboxOperators.ts); the session itself is an
// opaque RANDOM token, not a deterministic hash of any credential. On successful
// login the route issues a token and stores `inbox:session:<token>` in Redis with
// a 12h TTL; the token is the cookie value. Nothing derivable from the password is
// placed in the cookie, and there is no way to forge a valid cookie without the
// server-issued random token.
//
// IDENTITY. The Redis value holds the authenticated operator
// ({ operatorId, name, issuedAt }), so every guarded request resolves to a named
// person without a second lookup and without putting the identity in the cookie,
// where the operator could edit it. Sessions written before this change stored a
// bare timestamp string; those decode to LEGACY_SHARED_IDENTITY instead of being
// rejected, so the rollout does not log anyone out mid-shift.
//
// REVOCATION. Two levels, because a random Redis token is not invalidated by
// rotating a password (a common and dangerous assumption during an incident:
// the operator rotates the password, believes access is cut, and the attacker's
// cookie keeps working until its TTL expires):
//
//   1. Single session — destroySession(), called by POST /api/inbox/logout.
//   2. ALL sessions   — an epoch counter at `inbox:sessionEpoch`. Every token
//      embeds the epoch it was issued under, and validation rejects any token
//      whose epoch is not the current one. Bumping the counter therefore
//      invalidates every outstanding session instantly:
//
//          revokeAllSessions()            // from server code, or
//          INCR inbox:sessionEpoch        // by hand in the Upstash console
//
// Uses the Upstash REST client (fetch-based), so the same code runs in the Edge
// middleware runtime and in Node route handlers. Randomness uses the Web Crypto
// global for the same reason.

import { getRedis } from "./redis";
// Type-only: this module also runs in the Edge middleware runtime, and
// lib/inboxOperators.ts pulls in node:crypto. `import type` is erased at compile
// time, so nothing from it reaches the middleware bundle.
import type { OperatorIdentity } from "./inboxOperators";

export const INBOX_COOKIE = "inbox_session";

/**
 * Identity used for sessions that predate the per-operator registry, and for
 * logins that still use the legacy shared INBOX_PASSWORD. Explicit rather than
 * blank so those actions show up in the audit log as *unattributable* instead of
 * quietly resembling a named operator.
 */
export const LEGACY_SHARED_IDENTITY: OperatorIdentity = {
  operatorId: "shared-legacy",
  name: "Shared password (pre-O-6)",
};

// 12h session — short enough for a pilot, long enough to avoid re-login churn.
// Also used as the Redis TTL for the session key.
export const INBOX_SESSION_MAX_AGE_S = 12 * 60 * 60;

const SESSION_PREFIX = "inbox:session:";
const EPOCH_KEY = "inbox:sessionEpoch";

// v1.<epoch>.<64 hex chars>
const TOKEN_PATTERN = /^v1\.(\d+)\.[0-9a-f]{64}$/;

function sessionKey(token: string): string {
  return `${SESSION_PREFIX}${token}`;
}

/** 32 random bytes, hex-encoded. Web Crypto so it works in any runtime. */
function randomHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Current revocation epoch. A missing key means epoch 0 (nothing revoked yet). */
async function readEpoch(): Promise<number> {
  const r = getRedis();
  if (!r) throw new Error("Redis not configured — inbox sessions require Redis");
  const raw = await r.get(EPOCH_KEY);
  return normalizeEpoch(raw);
}

function normalizeEpoch(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

interface StoredSession {
  operatorId: string;
  name: string;
  issuedAt: number;
}

/**
 * Decode a stored session value into the operator it belongs to.
 *
 * Two shapes are accepted, and that is deliberate:
 *   - the current JSON `{ operatorId, name, issuedAt }`, and
 *   - the pre-O-6 bare timestamp string ("1750000000000"), which maps to
 *     LEGACY_SHARED_IDENTITY so already-issued cookies keep working.
 * The Upstash client may hand back an already-parsed object, so both a string and
 * an object are handled. Anything unrecognisable returns null (treated as
 * invalid), never a fabricated identity.
 */
function decodeSession(raw: unknown): OperatorIdentity | null {
  if (raw === null || raw === undefined) return null;

  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    // Legacy value: the millisecond timestamp of issue, nothing else.
    if (/^\d+$/.test(trimmed)) return LEGACY_SHARED_IDENTITY;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (typeof value === "number") return LEGACY_SHARED_IDENTITY;

  const parsed = value as Partial<StoredSession> | null;
  if (
    parsed &&
    typeof parsed.operatorId === "string" &&
    parsed.operatorId.length > 0 &&
    typeof parsed.name === "string"
  ) {
    return { operatorId: parsed.operatorId, name: parsed.name };
  }
  return null;
}

/**
 * Issue and persist a new session for `operator`, returning the cookie value. The
 * token carries the epoch it was minted under so a later bump can invalidate it
 * without any per-session bookkeeping; the Redis value carries the operator so
 * every later request knows who is acting. Throws when Redis is unavailable —
 * sessions require it.
 */
export async function issueSession(operator: OperatorIdentity): Promise<string> {
  const r = getRedis();
  if (!r) throw new Error("Redis not configured — inbox sessions require Redis");
  const epoch = await readEpoch();
  const token = `v1.${epoch}.${randomHex()}`;
  const value: StoredSession = {
    operatorId: operator.operatorId,
    name: operator.name,
    issuedAt: Date.now(),
  };
  await r.set(sessionKey(token), JSON.stringify(value), { ex: INBOX_SESSION_MAX_AGE_S });
  return token;
}

/**
 * Resolve a token to the operator it belongs to, or null when the session is not
 * valid. A session is valid only when ALL of these hold:
 *   - the token is well-formed,
 *   - its Redis key exists (not expired, not individually revoked),
 *   - the epoch embedded in it equals the current revocation epoch,
 *   - the stored value decodes to an identity.
 *
 * Fails CLOSED: a missing/malformed token, a missing key, a stale epoch, an
 * undecodable value, or any Redis error all return null. Session key and epoch are
 * read in a single MGET so this stays one round trip — it runs on every guarded
 * request.
 */
export async function readSession(
  token: string | undefined | null
): Promise<OperatorIdentity | null> {
  if (!token) return null;

  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const tokenEpoch = Number(match[1]);

  const r = getRedis();
  if (!r) return null;

  try {
    const [sessionValue, epochRaw] = (await r.mget(sessionKey(token), EPOCH_KEY)) as unknown[];
    if (sessionValue === null || sessionValue === undefined) return null;
    if (tokenEpoch !== normalizeEpoch(epochRaw)) return null;
    return decodeSession(sessionValue);
  } catch (err) {
    console.error(
      "[InboxAuth] session lookup failed (failing closed):",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Boolean form of readSession, for callers that only gate access and do not need
 * the identity (middleware.ts). Same fail-closed behaviour.
 */
export async function isValidSession(token: string | undefined | null): Promise<boolean> {
  return (await readSession(token)) !== null;
}

/** Revoke a single session (logout). Best-effort; a missing key is a no-op. */
export async function destroySession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(sessionKey(token));
  } catch {
    // best-effort revoke
  }
}

/**
 * Revoke EVERY outstanding session by bumping the epoch. Returns the new epoch.
 * Use this after a suspected credential leak — rotating a password (shared or
 * per-operator) alone does NOT invalidate sessions that were already issued.
 */
export async function revokeAllSessions(): Promise<number> {
  const r = getRedis();
  if (!r) throw new Error("Redis not configured — inbox sessions require Redis");
  return Number(await r.incr(EPOCH_KEY));
}

/** Reads the cookie header directly, so plain `Request` handlers can use it too. */
export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === INBOX_COOKIE) return rest.join("=") || undefined;
  }
  return undefined;
}
