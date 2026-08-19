import { NextResponse } from "next/server";
import { isValidSession, readSessionCookie } from "./inboxAuth";

// ── Per-route inbox guards ────────────────────────────────────────────────────
//
// middleware.ts already gates /inbox and /api/inbox/*, but middleware is a single
// perimeter: a route added outside the matcher, a rewrite, a path-normalization
// quirk, or a framework-level middleware bypass leaves the handler completely
// unauthenticated, because until now no inbox handler checked anything itself.
// Every inbox route calls requireInboxSession() as its first statement so
// authentication survives the perimeter failing. The middleware stays for the
// redirect-to-login UX and to reject unauthenticated traffic early.

/**
 * Returns a 401 response when the request has no valid inbox session, or null
 * when the caller may proceed. Fails closed (see isValidSession).
 */
export async function requireInboxSession(req: Request): Promise<NextResponse | null> {
  const token = readSessionCookie(req);
  if (await isValidSession(token)) return null;
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

/**
 * CSRF defence for state-changing inbox requests.
 *
 * The session cookie alone is not enough: SameSite is a *site* boundary, not an
 * origin one, so a page on any sibling subdomain (a marketing site, a vendor
 * subdomain, a stale DNS record someone takes over) can drive a cookie-bearing
 * POST/DELETE and, before this check, silently send a WhatsApp message as the
 * clinic or erase a patient's record.
 *
 * Browsers always attach Origin to POST/DELETE, so a mismatch is rejected. A
 * request with NO Origin is not a browser request and therefore not a CSRF
 * vector (curl, server-to-server), so it is allowed through — it still needs a
 * valid session cookie, which an attacker's page cannot read or forge.
 */
export function enforceSameOrigin(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  if (originHost !== host) {
    console.warn(`[InboxGuard] cross-origin request rejected origin=${origin} host=${host}`);
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** Session + CSRF check for mutating routes, in the order they should run. */
export async function requireInboxMutation(req: Request): Promise<NextResponse | null> {
  return (await requireInboxSession(req)) ?? enforceSameOrigin(req);
}
