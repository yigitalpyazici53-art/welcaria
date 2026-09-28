import { NextRequest, NextResponse } from "next/server";
import {
  INBOX_COOKIE,
  INBOX_SESSION_MAX_AGE_S,
  LEGACY_SHARED_IDENTITY,
  issueSession,
} from "@/lib/inboxAuth";
import {
  authenticateOperator,
  hasOperatorRegistry,
  type OperatorIdentity,
} from "@/lib/inboxOperators";
import { logInboxAction } from "@/lib/inboxAudit";
import { secretsMatch } from "@/lib/secretCompare";
import { getRedis } from "@/lib/redis";
import { envOrUndefined } from "@/lib/env";

// Login gate for the pilot inbox. On correct credentials this issues a random
// session token, stores it in Redis (TTL 12h) bound to the authenticated
// operator, and sets it as an HttpOnly cookie; middleware.ts and every route
// handler validate that token on each request. This route is deliberately exempt
// from the middleware guard (otherwise you could never log in).
//
// IDENTITY (O-6). Credentials are per-operator: { operatorId, password } checked
// against the INBOX_OPERATORS registry (lib/inboxOperators.ts). The old single
// shared INBOX_PASSWORD is accepted ONLY while no operator registry is
// configured, so deploying this change does not lock the clinic out; once
// INBOX_OPERATORS is set, the shared password stops working entirely and every
// session is attributable to a named person.
//
// Brute-force protection, all checked BEFORE the password comparison:
//   - per-IP:  5 attempts / 15 min, keyed on the platform-trusted client IP
//   - global:  a ceiling on FAILED logins per minute across all IPs
//   - the limiter fails CLOSED — if Redis cannot answer, login is refused

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_S = 15 * 60;

// Ceiling on failed logins per minute across every source. The per-IP limit alone
// is trivially sidestepped by rotating addresses (an IPv6 /64 or a proxy pool
// gives an attacker effectively unlimited buckets); this cap bounds the whole
// surface. Sized well above what a room full of staff mistyping a password
// produces, so a trip means something is wrong.
const GLOBAL_MAX_FAILURES_PER_MINUTE = 20;
const GLOBAL_FAILURE_KEY_TTL_S = 120;

/**
 * Client IP from a header the platform controls.
 *
 * NOT the first entry of `x-forwarded-for`: that is the classic
 * attacker-positioned value — anything the client prepends lands there, so a
 * limiter keyed on it is defeated by sending a different value each attempt.
 * `x-vercel-forwarded-for` (and `x-real-ip`) are set by the proxy and cannot be
 * spoofed by the client. When neither is present the request is not behind a
 * trusted proxy and there is no address worth trusting: everything falls into a
 * single shared bucket, which throttles harder rather than softer, and the
 * global cap above still applies.
 */
function clientIp(req: NextRequest): string {
  const vercelIp = req.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercelIp) return vercelIp;
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "untrusted-source";
}

function globalFailureKey(now: number): string {
  return `inbox:loginFailures:${Math.floor(now / 60_000)}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Per-operator registry is the primary credential source; the shared password
  // is the transitional fallback and is ignored once operators exist.
  const registryConfigured = hasOperatorRegistry();
  const sharedPassword = envOrUndefined("INBOX_PASSWORD");
  if (!registryConfigured && !sharedPassword) {
    return NextResponse.json(
      { ok: false, error: "No inbox operators configured on server (INBOX_OPERATORS)" },
      { status: 500 }
    );
  }

  // Sessions require Redis, and so does the rate limiter. Without it there is no
  // way to both authenticate and throttle, so refuse up front rather than serve
  // an unthrottled login.
  const r = getRedis();
  if (!r) {
    return NextResponse.json(
      { ok: false, error: "Session storage unavailable — Redis not configured" },
      { status: 500 }
    );
  }

  const now = Date.now();

  // ── Rate limits (before the password check) ────────────────────────────────
  // A limiter that cannot reach its backend must not wave requests through: that
  // turned a Redis outage — which an attacker can help along — into an
  // unthrottled brute-force window. Refuse instead, and say so.
  try {
    const attemptsKey = `inbox:loginAttempts:${clientIp(req)}`;
    const count = await r.incr(attemptsKey);
    if (count === 1) await r.expire(attemptsKey, LOGIN_WINDOW_S);
    if (count > MAX_LOGIN_ATTEMPTS) {
      return NextResponse.json(
        { ok: false, error: "Too many attempts. Please try again later." },
        { status: 429 }
      );
    }

    const globalFailures = Number((await r.get(globalFailureKey(now))) ?? 0);
    if (globalFailures >= GLOBAL_MAX_FAILURES_PER_MINUTE) {
      console.error(
        `[InboxLogin] global failed-login ceiling reached (${globalFailures}/min) — refusing logins this minute`
      );
      return NextResponse.json(
        { ok: false, error: "Too many attempts. Please try again later." },
        { status: 429 }
      );
    }
  } catch (err) {
    console.error(
      "[InboxLogin] rate-limit check failed (failing closed):",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { ok: false, error: "Login temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }

  let parsed: { operatorId?: string; password?: string };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Credential check ───────────────────────────────────────────────────────
  let identity: OperatorIdentity | null = null;
  if (registryConfigured) {
    identity = await authenticateOperator(parsed.operatorId, parsed.password);
  } else if (sharedPassword && secretsMatch(parsed.password, sharedPassword)) {
    identity = LEGACY_SHARED_IDENTITY;
    console.warn(
      "[InboxLogin] shared-password login — set INBOX_OPERATORS so inbox actions are attributable (O-6)"
    );
  }

  if (!identity) {
    try {
      const key = globalFailureKey(now);
      const failures = await r.incr(key);
      if (failures === 1) await r.expire(key, GLOBAL_FAILURE_KEY_TTL_S);
    } catch {
      // Counting is best-effort; the refusal below is what matters.
    }
    // A failed attempt is part of the access trail. The submitted operatorId is
    // echoed only as `detail` and never trusted as an identity — the entry is
    // attributed to no one, which is exactly what happened.
    const attempted =
      typeof parsed.operatorId === "string" ? parsed.operatorId.trim().slice(0, 64) : "";
    await logInboxAction({
      operator: { operatorId: "-", name: "(unauthenticated)" },
      action: "login_failed",
      outcome: "denied",
      detail: attempted ? `attempted operatorId=${attempted}` : "no operatorId supplied",
    });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // ── Create a random, server-issued session in Redis ─────────────────────────
  let token: string;
  try {
    token = await issueSession(identity);
  } catch (err) {
    console.error(
      "[InboxLogin] failed to persist session:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { ok: false, error: "Could not create session" },
      { status: 500 }
    );
  }

  await logInboxAction({ operator: identity, action: "login" });

  const res = NextResponse.json({ ok: true, operator: identity });
  res.cookies.set(INBOX_COOKIE, token, {
    httpOnly: true,
    // Strict, not Lax: Lax still attaches the cookie to same-SITE requests, and
    // "same site" includes every sibling subdomain — a page on one of those could
    // drive a state-changing inbox request with the operator's session.
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: INBOX_SESSION_MAX_AGE_S,
  });
  return res;
}
