import { Resend } from "resend";
import { readLeadsForDateRange } from "./googleSheets";
import { clinicConfig } from "./clinicConfig";

export interface LeadSummaryEntry {
  name: string;
  service: string;
  preferredTime: string;
  phone: string;
}

export interface DailySummary {
  date: string;
  totalInquiries: number;
  qualifiedLeads: number;
  hotLeads: number;
  afterHoursLeads: number;
  topLeads: LeadSummaryEntry[];
}

// Turkey is permanently UTC+3 (no DST since 2016)
function isAfterHours(isoString: string): boolean {
  const h = (new Date(isoString).getUTCHours() + 3) % 24;
  return h < 9 || h >= 18;
}

export async function computeDailySummary(targetDate: Date): Promise<DailySummary> {
  const from = new Date(targetDate);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(targetDate);
  to.setUTCHours(23, 59, 59, 999);

  const leads = await readLeadsForDateRange(from, to);

  const hotLeads     = leads.filter((l) => l.leadScore === "hot");
  const warmLeads    = leads.filter((l) => l.leadScore === "warm");
  const qualified    = leads.filter((l) => l.leadScore === "warm" || l.leadScore === "hot");
  const afterHours   = leads.filter((l) => l.createdAt && isAfterHours(l.createdAt));

  const topLeads = [...hotLeads, ...warmLeads].slice(0, 3).map((l) => ({
    name:          l.name         || "—",
    service:       l.service      || "Inquiry",
    preferredTime: [l.preferredDate, l.preferredTime].filter(Boolean).join(" ") || "Not specified",
    phone:         l.phone        || "—",
  }));

  return {
    date:              from.toISOString().split("T")[0],
    totalInquiries:    leads.length,
    qualifiedLeads:    qualified.length,
    hotLeads:          hotLeads.length,
    afterHoursLeads:   afterHours.length,
    topLeads,
  };
}

export function buildEmailSubject(): string {
  return `RandevuFlow Daily Lead Summary — ${clinicConfig.name}`;
}

export function buildEmailText(summary: DailySummary): string {
  const lines: string[] = [
    `Yesterday's RandevuFlow summary for ${clinicConfig.name}:`,
    "",
    `Total inquiries:    ${summary.totalInquiries}`,
    `Qualified leads:    ${summary.qualifiedLeads}`,
    `Hot leads:          ${summary.hotLeads}`,
    `After-hours leads:  ${summary.afterHoursLeads}`,
    `Avg AI response:    under 60 seconds`,
    "",
  ];

  if (summary.totalInquiries === 0) {
    lines.push("No leads were recorded yesterday.");
  } else if (summary.topLeads.length > 0) {
    lines.push("Top leads:");
    lines.push("");
    summary.topLeads.forEach((lead, i) => {
      lines.push(`${i + 1}. ${lead.name} — ${lead.service} — ${lead.preferredTime} — ${lead.phone}`);
    });
  }

  lines.push("");
  lines.push("Notes:");
  lines.push("* These are appointment requests, not confirmed bookings.");
  if (summary.hotLeads > 0) {
    lines.push("* Follow up quickly with hot leads.");
  }

  return lines.join("\n");
}

export function buildEmailHtml(summary: DailySummary): string {
  const emptyMsg =
    summary.totalInquiries === 0
      ? `<p style="color:#6b7280"><em>No leads were recorded yesterday.</em></p>`
      : "";

  const topLeadsHtml =
    summary.topLeads.length > 0
      ? `<h3 style="color:#1a1a1a;margin-top:24px;margin-bottom:8px">Top leads</h3>
<ol style="padding-left:20px;line-height:2;margin:0">
${summary.topLeads
  .map(
    (l) =>
      `  <li><strong>${l.name}</strong> &mdash; ${l.service} &mdash; ${l.preferredTime} &mdash; ${l.phone}</li>`
  )
  .join("\n")}
</ol>`
      : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;padding:24px">
  <h2 style="color:#2563eb;margin-bottom:4px">RandevuFlow Daily Summary</h2>
  <p style="color:#6b7280;margin-top:0;margin-bottom:16px">${clinicConfig.name} &middot; ${summary.date}</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px">
  <table style="width:100%;border-collapse:collapse">
    <tr>
      <td style="padding:6px 0;color:#6b7280">Total inquiries</td>
      <td style="padding:6px 0;font-weight:600;text-align:right">${summary.totalInquiries}</td>
    </tr>
    <tr>
      <td style="padding:6px 0;color:#6b7280">Qualified leads</td>
      <td style="padding:6px 0;font-weight:600;text-align:right">${summary.qualifiedLeads}</td>
    </tr>
    <tr>
      <td style="padding:6px 0;color:#6b7280">Hot leads</td>
      <td style="padding:6px 0;font-weight:600;text-align:right;color:#dc2626">${summary.hotLeads}</td>
    </tr>
    <tr>
      <td style="padding:6px 0;color:#6b7280">After-hours leads</td>
      <td style="padding:6px 0;font-weight:600;text-align:right">${summary.afterHoursLeads}</td>
    </tr>
    <tr>
      <td style="padding:6px 0;color:#6b7280">Avg AI response</td>
      <td style="padding:6px 0;font-weight:600;text-align:right">under 60 seconds</td>
    </tr>
  </table>
  ${emptyMsg}
  ${topLeadsHtml}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px">
  <p style="font-size:13px;color:#6b7280;margin:0">
    These are appointment requests, not confirmed bookings.${summary.hotLeads > 0 ? " Follow up quickly with hot leads." : ""}
  </p>
</body>
</html>`;
}

export async function sendDailySummary(summary: DailySummary): Promise<void> {
  const apiKey     = process.env.RESEND_API_KEY;
  const ownerEmail = clinicConfig.ownerEmail;
  const fromEmail  = process.env.RESEND_FROM_EMAIL ?? "RandevuFlow <onboarding@resend.dev>";

  if (!apiKey)      throw new Error("RESEND_API_KEY is not set");
  if (!ownerEmail)  throw new Error("OWNER_EMAIL is not set");

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from:    fromEmail,
    to:      ownerEmail,
    subject: buildEmailSubject(),
    text:    buildEmailText(summary),
    html:    buildEmailHtml(summary),
  });

  if (error) {
    throw new Error(`Resend send failed: ${(error as { message?: string }).message ?? JSON.stringify(error)}`);
  }
}
