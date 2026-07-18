import { NextRequest, NextResponse } from "next/server";
import {
  INBOX_COOKIE,
  INBOX_SESSION_MAX_AGE_S,
  generateSessionToken,
  createSession,
} from "@/lib/inboxAuth";
import { secretsMatch } from "@/lib/secretCompare";
import { getRedis } from "@/lib/redis";

// Password gate for the pilot inbox. On a correct password this generates a
// random session token, stores it in Redis (TTL 12h), and sets it as an HttpOnly
// cookie; middleware.ts validates that token against Redis on every /inbox and
// /api/inbox/* request. This route is deliberately exempt from the middleware
// guard (otherwise you could never log in).
//
// Brute-force protection: at most 5 attempts per IP per 15 minutes (Redis
// counter with TTL), checked BEFORE the password comparison.

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_S = 15 * 60;

function clientIp(req: NextRequest): string {
  // Vercel sets x-forwarded-for; the first entry is the originating client.
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0]?.trim();
  return first || "unknown";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const configured = process.env.INBOX_PASSWORD;
  if (!configured) {
    return NextResponse.json(
      { ok: false, error: "INBOX_PASSWORD not configured on server" },
      { status: 500 }
    );
  }

  const r = getRedis();

  // ── Rate limit (before password check) ──────────────────────────────────────
  if (r) {
    const attemptsKey = `inbox:loginAttempts:${clientIp(req)}`;
    try {
      const count = await r.incr(attemptsKey);
      if (count === 1) await r.expire(attemptsKey, LOGIN_WINDOW_S);
      if (count > MAX_LOGIN_ATTEMPTS) {
        return NextResponse.json(
          { ok: false, error: "Too many attempts. Please try again later." },
          { status: 429 }
        );
      }
    } catch (err) {
      // A limiter-backend failure must not lock everyone out — log and continue.
      console.error(
        "[InboxLogin] rate-limit check failed (allowing attempt):",
        err instanceof Error ? err.message : err
      );
    }
  }

  let parsed: { password?: string };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!secretsMatch(parsed.password, configured)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // ── Create a random, server-issued session in Redis ─────────────────────────
  if (!r) {
    return NextResponse.json(
      { ok: false, error: "Session storage unavailable — Redis not configured" },
      { status: 500 }
    );
  }

  const token = generateSessionToken();
  try {
    await createSession(token);
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

  const res = NextResponse.json({ ok: true });
  res.cookies.set(INBOX_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: INBOX_SESSION_MAX_AGE_S,
  });
  return res;
}
