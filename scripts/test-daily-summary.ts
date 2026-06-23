/**
 * RandevuFlow — daily summary preview test script.
 *
 * Usage:
 *   npm run test-daily-summary
 *
 * Calls GET /api/cron/daily-summary?preview=1 with the Authorization header
 * and prints summary counts, subject, and whether text/HTML was generated.
 *
 * Requires the dev server to be running: npm run dev
 *
 * Optional env overrides (in .env.local):
 *   NEXT_PUBLIC_BASE_URL — defaults to http://localhost:3000
 *   CRON_SECRET          — secret used in Authorization header
 */

import * as fs from "fs";
import * as path from "path";

const envFile = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
  console.log("Loaded .env.local\n");
} else {
  console.warn("WARNING: .env.local not found — using existing environment\n");
}

interface PreviewResponse {
  ok: boolean;
  preview: boolean;
  summary: {
    date: string;
    totalInquiries: number;
    qualifiedLeads: number;
    hotLeads: number;
    afterHoursLeads: number;
    topLeads: Array<{
      name: string;
      service: string;
      preferredTime: string;
      phone: string;
    }>;
  };
  subject: string;
  textLength: number;
  htmlLength: number;
  text: string;
  html: string;
}

async function main() {
  const BASE_URL    = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const CRON_SECRET = process.env.CRON_SECRET ?? "";

  console.log("=== test-daily-summary (preview mode) ===\n");
  console.log(`Base URL:     ${BASE_URL}`);
  console.log(`Secret set:   ${CRON_SECRET ? "yes" : "NO — set CRON_SECRET in .env.local"}`);

  const url = `${BASE_URL}/api/cron/daily-summary?preview=1`;
  console.log(`\nGET ${url}\n`);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
  } catch (err) {
    console.error("Could not reach server:", err instanceof Error ? err.message : err);
    console.error("Is the dev server running? (npm run dev)");
    process.exit(1);
  }

  console.log(`Status: ${res.status} ${res.statusText}`);

  if (res.status === 401) {
    console.error("\nUnauthorized — check CRON_SECRET in .env.local matches the server.");
    process.exit(1);
  }

  if (!res.ok) {
    const body = await res.text();
    console.error("\nError response:", body);
    process.exit(1);
  }

  const data = (await res.json()) as PreviewResponse;

  console.log("\n── Summary ──────────────────────────");
  console.log(`Date:             ${data.summary.date}`);
  console.log(`Total inquiries:  ${data.summary.totalInquiries}`);
  console.log(`Qualified leads:  ${data.summary.qualifiedLeads}`);
  console.log(`Hot leads:        ${data.summary.hotLeads}`);
  console.log(`After-hours:      ${data.summary.afterHoursLeads}`);
  console.log(`Top leads:        ${data.summary.topLeads.length}`);

  console.log("\n── Email ────────────────────────────");
  console.log(`Subject:   ${data.subject}`);
  console.log(`Text:      ${data.textLength} chars  ${data.textLength > 0 ? "✓" : "EMPTY"}`);
  console.log(`HTML:      ${data.htmlLength} chars  ${data.htmlLength > 0 ? "✓" : "EMPTY"}`);

  if (data.summary.topLeads.length > 0) {
    console.log("\n── Top Leads ────────────────────────");
    data.summary.topLeads.forEach((lead, i) => {
      console.log(`  ${i + 1}. ${lead.name} — ${lead.service} — ${lead.preferredTime} — ${lead.phone}`);
    });
  }

  console.log("\n── Text Preview ─────────────────────");
  console.log(data.text);

  console.log("\n=== DONE ===");
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
