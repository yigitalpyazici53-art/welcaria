import crypto from "crypto";
import { promisify } from "util";
import { envOrUndefined } from "./env";

// ── Per-operator inbox identity registry (pilot) ──────────────────────────────
//
// Replaces the single shared INBOX_PASSWORD. Every operator has their own
// { operatorId, name, passwordHash }, so every inbox action can be attributed to
// a named person — the KVKK accountability requirement behind finding O-6.
//
// WHY AN ENV VAR AND NOT A REDIS CONFIG KEY.
// The registry is *authentication configuration*, and this codebase already
// keeps every credential in the environment (INBOX_PASSWORD, TEST_WEBHOOK_SECRET,
// the Upstash token itself). Putting it in Redis would:
//   - create a bootstrap hole — an empty/flushed Redis means either nobody can
//     log in or, worse, a tempting "seed a default operator" path;
//   - widen the blast radius of a leaked Upstash token from "read patient state"
//     to "write yourself an operator row and log in as staff", i.e. the store
//     holding the audit trail could also mint the identities it audits;
//   - add a network read to the login path that must then fail closed anyway.
// The env var is versioned with the deploy, rotates atomically, and is readable
// only by someone who already controls the project. Redis stays what it is here:
// runtime state, not the source of truth for who may log in.
//
// HASHING. No bcrypt/argon2 dependency exists in this project and adding one for
// a pilot is not worth the native-build surface, so this uses Node's built-in
// scrypt (memory-hard, the recommended built-in for password storage). Login
// routes run on the Node runtime, so `node:crypto` is available; middleware never
// touches this module (it only validates an already-issued session token).

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>;

// N=16384, r=8, p=1 → ~16 MB and ~50-100ms per derivation. Well within the
// default maxmem (32 MB) and cheap enough that the login rate limiter, not the
// KDF, remains the thing that bounds a brute-force attempt.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

/** Stored form: scrypt$<N>$<r>$<p>$<saltB64>$<hashB64> */
const HASH_PREFIX = "scrypt";

export interface InboxOperator {
  operatorId: string;
  name: string;
  passwordHash: string;
}

/** What gets bound to a session and written to every audit line. */
export interface OperatorIdentity {
  operatorId: string;
  name: string;
}

// ── Password hashing ──────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LEN);
  const derived = await scrypt(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    HASH_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  // Bound the work factor: the hash string is operator-supplied config, and a
  // typo'd N of 2^30 would hang the login route rather than reject a password.
  if (N < 1024 || N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  try {
    const salt = Buffer.from(parts[4], "base64");
    const hash = Buffer.from(parts[5], "base64");
    if (salt.length === 0 || hash.length === 0) return null;
    return { N, r, p, salt, hash };
  } catch {
    return null;
  }
}

/**
 * Constant-time password check against a stored scrypt hash. Never throws — a
 * malformed hash is a false, not a 500, so one bad registry row cannot take the
 * login route down for everyone.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  try {
    const derived = await scrypt(password, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      // 128 * N * r plus headroom, so a legitimately larger N still runs.
      maxmem: 256 * parsed.N * parsed.r,
    });
    return crypto.timingSafeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

/**
 * Burns roughly one scrypt derivation without revealing anything, so an unknown
 * operatorId costs the same wall-clock time as a known one. Without this,
 * response timing enumerates which operator ids exist.
 */
async function burnEquivalentWork(password: string): Promise<void> {
  try {
    await scrypt(password, Buffer.alloc(SALT_LEN), KEY_LEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
  } catch {
    // timing padding only
  }
}

// ── Registry (INBOX_OPERATORS) ────────────────────────────────────────────────

let cacheRaw: string | null = null;
let cacheValue: InboxOperator[] = [];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Parses INBOX_OPERATORS — a JSON array of { operatorId, name, passwordHash } —
 * into the operator list. Supports any number of operators. Invalid rows are
 * dropped with a warning rather than throwing, so one bad entry never locks the
 * whole clinic out. Result is memoised on the raw string (env is fixed per
 * deploy) so scrypt-era logins do not re-parse on every attempt.
 */
export function listOperators(): InboxOperator[] {
  const raw = envOrUndefined("INBOX_OPERATORS")?.trim() ?? "";
  if (raw === cacheRaw) return cacheValue;

  const operators: InboxOperator[] = [];
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(
        "[InboxOperators] INBOX_OPERATORS is not valid JSON — no operators loaded:",
        err instanceof Error ? err.message : err
      );
      parsed = null;
    }
    if (Array.isArray(parsed)) {
      const seen = new Set<string>();
      for (const entry of parsed) {
        const row = entry as Partial<InboxOperator> | null;
        if (
          !row ||
          !isNonEmptyString(row.operatorId) ||
          !isNonEmptyString(row.name) ||
          !isNonEmptyString(row.passwordHash)
        ) {
          console.error("[InboxOperators] skipping malformed operator entry");
          continue;
        }
        const operatorId = row.operatorId.trim().toLowerCase();
        if (seen.has(operatorId)) {
          console.error(`[InboxOperators] duplicate operatorId "${operatorId}" — skipping`);
          continue;
        }
        if (!parseHash(row.passwordHash)) {
          console.error(
            `[InboxOperators] operator "${operatorId}" has an unreadable passwordHash — skipping`
          );
          continue;
        }
        seen.add(operatorId);
        operators.push({ operatorId, name: row.name.trim(), passwordHash: row.passwordHash });
      }
    } else if (parsed !== null) {
      console.error("[InboxOperators] INBOX_OPERATORS must be a JSON array");
    }
  }

  cacheRaw = raw;
  cacheValue = operators;
  return operators;
}

/** True once at least one valid operator exists — the switch off legacy login. */
export function hasOperatorRegistry(): boolean {
  return listOperators().length > 0;
}

/**
 * Authenticates operatorId + password against the registry. Returns the identity
 * to bind to the session, or null. Unknown ids and wrong passwords are
 * indistinguishable to the caller and cost the same time.
 */
export async function authenticateOperator(
  operatorId: string | undefined | null,
  password: string | undefined | null
): Promise<OperatorIdentity | null> {
  const id = typeof operatorId === "string" ? operatorId.trim().toLowerCase() : "";
  const pw = typeof password === "string" ? password : "";
  const operator = id ? listOperators().find((o) => o.operatorId === id) : undefined;

  if (!operator || pw.length === 0) {
    await burnEquivalentWork(pw);
    return null;
  }
  if (!(await verifyPassword(pw, operator.passwordHash))) return null;
  return { operatorId: operator.operatorId, name: operator.name };
}
