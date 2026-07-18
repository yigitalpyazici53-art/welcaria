// ── Inbox session store (pilot) ───────────────────────────────────────────────
//
// A single shared password (INBOX_PASSWORD) still gates login, but the session
// itself is now an opaque RANDOM token, not a deterministic hash of the password.
// On successful login the route generates a random token and stores
// `inbox:session:<token>` in Redis with a 12h TTL; the token is the cookie value.
// Validation (middleware + API routes) is a pure Redis existence check — so
// sessions expire automatically at the TTL and can be revoked by deleting the key.
// Nothing derivable from the password is placed in the cookie, and there is no way
// to forge a valid cookie without the server-issued random token.
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

function sessionKey(token: string): string {
  return `${SESSION_PREFIX}${token}`;
}

/**
 * A fresh, unguessable session token (32 random bytes, hex-encoded). Uses the
 * Web Crypto global so it works in any runtime.
 */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Persist a new session: `inbox:session:<token>` → issue timestamp, TTL 12h.
 * Throws when Redis is not configured (sessions require Redis).
 */
export async function createSession(token: string): Promise<void> {
  const r = getRedis();
  if (!r) throw new Error("Redis not configured — inbox sessions require Redis");
  await r.set(sessionKey(token), String(Date.now()), { ex: INBOX_SESSION_MAX_AGE_S });
}

/**
 * Session is valid iff its Redis key exists. Returns false for a missing/empty
 * token, an expired or revoked session, or any Redis error (fail closed).
 */
export async function isValidSession(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const r = getRedis();
  if (!r) return false;
  try {
    const value = await r.get(sessionKey(token));
    return value !== null && value !== undefined;
  } catch (err) {
    console.error(
      "[InboxAuth] session lookup failed (failing closed):",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/** Revoke a session (e.g. logout). Best-effort; a missing key is a no-op. */
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
