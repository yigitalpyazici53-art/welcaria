import { NextRequest, NextResponse } from "next/server";
import {
  computeDailySummary,
  buildEmailSubject,
  buildEmailText,
  buildEmailHtml,
  sendDailySummary,
} from "@/lib/dailySummary";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader  = req.headers.get("authorization");
  const cronSecret  = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const isPreview = searchParams.get("preview") === "1";

  // Optional date override for testing: ?date=YYYY-MM-DD (UTC)
  const dateParam = searchParams.get("date");
  let targetDate: Date;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    targetDate = new Date(`${dateParam}T00:00:00.000Z`);
  } else {
    targetDate = new Date();
    targetDate.setUTCDate(targetDate.getUTCDate() - 1);
  }

  let summary;
  try {
    summary = await computeDailySummary(targetDate);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[DailySummary] computeDailySummary failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  if (isPreview) {
    const text = buildEmailText(summary);
    const html = buildEmailHtml(summary);
    return NextResponse.json({
      ok:         true,
      preview:    true,
      summary,
      subject:    buildEmailSubject(),
      textLength: text.length,
      htmlLength: html.length,
      text,
      html,
    });
  }

  const apiKey     = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;

  if (!apiKey || !ownerEmail) {
    const missing = [!apiKey && "RESEND_API_KEY", !ownerEmail && "OWNER_EMAIL"].filter(Boolean);
    return NextResponse.json(
      { ok: false, error: `Missing env vars: ${missing.join(", ")}` },
      { status: 500 }
    );
  }

  try {
    await sendDailySummary(summary);
    console.log(`[DailySummary] Sent for ${summary.date} — ${summary.totalInquiries} lead(s)`);
    return NextResponse.json({ ok: true, sent: true, totalLeads: summary.totalInquiries });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[DailySummary] Send failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
