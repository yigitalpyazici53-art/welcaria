import { NextRequest, NextResponse } from "next/server";
import { INBOX_COOKIE, isValidSession } from "@/lib/inboxAuth";

// Guards the pilot inbox: the /inbox page and every /api/inbox/* route require a
// valid session. A request is authorized only when its inbox_session cookie holds
// a token that still exists in Redis (set by POST /api/inbox/login, TTL 12h) and
// was issued under the current revocation epoch.
//
// This is the perimeter, NOT the only check: every /api/inbox route handler also
// calls requireInboxSession() itself (see lib/inboxGuard.ts), so authentication
// does not depend on this matcher covering the path.
// Unauthenticated page requests redirect to the login view; unauthenticated API
// requests get 401. The login endpoint and the login page are exempt so they stay
// reachable.
export const config = {
  matcher: ["/inbox/:path*", "/api/inbox/:path*"],
};

const LOGIN_PAGE = "/inbox/login";
const LOGIN_API = "/api/inbox/login";
// Logout must stay reachable with an expired or revoked session so the stale
// cookie can still be cleared; it revokes only the caller's own token.
const LOGOUT_API = "/api/inbox/logout";

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/inbox");

  // Never guard the login surfaces themselves (avoids a redirect loop).
  if (pathname === LOGIN_PAGE || pathname === LOGIN_API || pathname === LOGOUT_API) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(INBOX_COOKIE)?.value;
  if (await isValidSession(cookie)) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL(LOGIN_PAGE, req.url));
}
