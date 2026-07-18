import { NextRequest, NextResponse } from "next/server";
import { INBOX_COOKIE, isValidSession } from "@/lib/inboxAuth";

// Guards the pilot inbox: the /inbox page and every /api/inbox/* route require a
// valid session. A request is authorized only when its inbox_session cookie holds
// a token that still exists in Redis (set by POST /api/inbox/login, TTL 12h).
// Unauthenticated page requests redirect to the login view; unauthenticated API
// requests get 401. The login endpoint and the login page are exempt so they stay
// reachable.
export const config = {
  matcher: ["/inbox/:path*", "/api/inbox/:path*"],
};

const LOGIN_PAGE = "/inbox/login";
const LOGIN_API = "/api/inbox/login";

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/inbox");

  // Never guard the login surfaces themselves (avoids a redirect loop).
  if (pathname === LOGIN_PAGE || pathname === LOGIN_API) {
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
