import { NextRequest, NextResponse } from "next/server";
import {
  checkInactivityNudges,
  getInactivityNudgeDays,
  listKnownTenants,
} from "@/lib/compliance";
import { envOrUndefined } from "@/lib/env";

// Coexistence keepalive check: WhatsApp coexistence connections disconnect
// after ~13–14 days of inactivity on the number. This cron flags tenants idle
// >= COMPLIANCE_INACTIVITY_NUDGE_DAYS (default 10) and alerts the operator
// (stub) so they can generate activity in time. It NEVER sends anything to
// patients — an automated keepalive message would itself be a compliance risk.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = envOrUndefined("CRON_SECRET");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tenants = await listKnownTenants();
    const flagged = await checkInactivityNudges();
    return NextResponse.json({
      ok: true,
      nudgeDays: getInactivityNudgeDays(),
      tenantsChecked: tenants.length,
      flagged,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[InactivityCheck] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
