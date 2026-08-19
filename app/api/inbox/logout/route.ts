import { NextResponse } from "next/server";
import { INBOX_COOKIE, destroySession, readSessionCookie } from "@/lib/inboxAuth";
import { enforceSameOrigin } from "@/lib/inboxGuard";

// Ends the caller's inbox session: deletes the token from Redis so it cannot be
// replayed, then clears the cookie. Without this there was no way to end a
// session at all — a token stayed valid for its full 12h TTL no matter what,
// including after the shared password was rotated in response to a leak.
//
// Deliberately exempt from the middleware session guard (like the login route):
// a caller whose session has already expired or been revoked must still be able
// to clear the stale cookie. The token comes from the caller's own cookie, so
// this can only ever revoke the caller's own session. The Origin check keeps a
// hostile page from force-logging-out a signed-in operator.
export async function POST(req: Request): Promise<NextResponse> {
  const blocked = enforceSameOrigin(req);
  if (blocked) return blocked;

  const token = readSessionCookie(req);
  await destroySession(token);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(INBOX_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
