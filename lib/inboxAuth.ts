// ── Inbox session store (pilot) ───────────────────────────────────────────────
//
// A single shared password (INBOX_PASSWORD) still gates login, but the session
// itself is an opaque RANDOM token, not a deterministic hash of the password.
// On successful login the route issues a token and stores `inbox:session:<token>`
// in Redis with a 12h TTL; the token is the cookie value. Nothing derivable from
// the password is placed in the cookie, and there is no way to forge a valid
// cookie without the server-issued random token.
//
// REVOCATION. Two levels, because a random Redis token is not invalidated by
// rotating INBOX_PASSWORD (a common and dangerous assumption during an incident:
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

export const INBOX_COOKIE = "inbox_session";

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

/**
 * Issue and persist a new session, returning the cookie value. The token carries
 * the epoch it was minted under so a later bump can invalidate it without any
 * per-session bookkeeping. Throws when Redis is unavailable — sessions require it.
 */
export async function issueSession(): Promise<string> {
  const r = getRedis();
  if (!r) throw new Error("Redis not configured — inbox sessions require Redis");
  const epoch = await readEpoch();
  const token = `v1.${epoch}.${randomHex()}`;
  await r.set(sessionKey(token), String(Date.now()), { ex: INBOX_SESSION_MAX_AGE_S });
  return token;
}

/**
 * A session is valid only when ALL of these hold:
 *   - the token is well-formed,
 *   - its Redis key exists (not expired, not individually revoked),
 *   - the epoch embedded in it equals the current revocation epoch.
 *
 * Fails CLOSED: a missing/malformed token, a missing key, a stale epoch, or any
 * Redis error all return false. Session key and epoch are read in a single MGET
 * so this stays one round trip — it runs on every guarded request.
 */
export async function isValidSession(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;

  const match = TOKEN_PATTERN.exec(token);
  if (!match) return false;
  const tokenEpoch = Number(match[1]);

  const r = getRedis();
  if (!r) return false;

  try {
    const [sessionValue, epochRaw] = (await r.mget(sessionKey(token), EPOCH_KEY)) as unknown[];
    if (sessionValue === null || sessionValue === undefined) return false;
    return tokenEpoch === normalizeEpoch(epochRaw);
  } catch (err) {
    console.error(
      "[InboxAuth] session lookup failed (failing closed):",
      err instanceof Error ? err.message : err
    );
    return false;
  }
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
 * Use this after a suspected password leak — rotating INBOX_PASSWORD alone does
 * NOT invalidate sessions that were already issued.
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
