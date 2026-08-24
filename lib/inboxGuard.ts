import { NextResponse } from "next/server";
import { readSession, readSessionCookie } from "./inboxAuth";
import type { OperatorIdentity } from "./inboxOperators";

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
 * Result of a guard: either the authenticated operator, or the response to
 * return. A discriminated union rather than `NextResponse | null` so a handler
 * cannot reach the action without having gone through the identity check — the
 * operator is only obtainable from a successful guard, and every audit line is
 * written from it. Fails closed (see readSession).
 */
export type InboxAuthResult =
  | { ok: true; operator: OperatorIdentity }
  | { ok: false; response: NextResponse };

function unauthorized(): InboxAuthResult {
  return {
    ok: false,
    response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
  };
}

/**
 * Authenticates the request and returns the acting operator. Callers must use the
 * returned identity when logging the action (lib/inboxAudit.ts) — that pairing is
 * what makes inbox access attributable under KVKK.
 */
export async function requireInboxSession(req: Request): Promise<InboxAuthResult> {
  const token = readSessionCookie(req);
  const operator = await readSession(token);
  if (!operator) return unauthorized();
  return { ok: true, operator };
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
export async function requireInboxMutation(req: Request): Promise<InboxAuthResult> {
  const session = await requireInboxSession(req);
  if (!session.ok) return session;
  const crossOrigin = enforceSameOrigin(req);
  if (crossOrigin) return { ok: false, response: crossOrigin };
  return session;
}
