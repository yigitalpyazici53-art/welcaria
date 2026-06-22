import { NextRequest, NextResponse } from "next/server";
import { logToSheet } from "@/lib/googleSheets";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const configuredSecret = process.env.TEST_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return NextResponse.json(
      { ok: false, error: "TEST_WEBHOOK_SECRET not configured on server" },
      { status: 500 }
    );
  }

  let parsed: { secret?: string };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!parsed.secret || parsed.secret !== configuredSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const hasGoogleServiceAccountEmail = !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const hasGooglePrivateKey = !!process.env.GOOGLE_PRIVATE_KEY;
  const hasGoogleSheetId = !!process.env.GOOGLE_SHEET_ID;

  const result = await logToSheet({
    createdAt: new Date().toISOString(),
    source: "test",
    name: "RandevuFlow Test",
    phone: "+447700900123",
    service: "laser hair removal",
    preferredDate: "saturday",
    preferredTime: "afternoon",
    location: "",
    urgency: "",
    leadScore: "hot",
    intent: "test_google_sheets",
    notes: "Production Google Sheets logging test",
    conversationSummary: "Test row from protected endpoint",
    status: "complete",
  });

  if (result.skipped) {
    return NextResponse.json({
      ok: false,
      attempted: true,
      hasGoogleServiceAccountEmail,
      hasGooglePrivateKey,
      hasGoogleSheetId,
      error: `Skipped — missing env vars: ${result.missingVars?.join(", ")}`,
    });
  }

  if (result.error) {
    return NextResponse.json({
      ok: false,
      attempted: true,
      hasGoogleServiceAccountEmail,
      hasGooglePrivateKey,
      hasGoogleSheetId,
      error: result.error,
    });
  }

  return NextResponse.json({
    ok: true,
    attempted: true,
    hasGoogleServiceAccountEmail,
    hasGooglePrivateKey,
    hasGoogleSheetId,
  });
}
