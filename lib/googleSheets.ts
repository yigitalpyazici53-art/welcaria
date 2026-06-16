import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function getAuth() {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: SCOPES,
  });
}

// Columns: created_at | source | name | phone | service | preferred_date |
//          preferred_time | location | urgency | lead_score | intent |
//          notes | conversation_summary | status
export interface LogEntry {
  createdAt: string;
  source: string;
  name: string;
  phone: string;
  service: string;
  preferredDate: string;
  preferredTime: string;
  location: string;
  urgency: string;
  leadScore: string;
  intent: string;
  notes: string;
  conversationSummary: string;
  status: string;
}

export async function logToSheet(entry: LogEntry): Promise<void> {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;

  if (!sheetId || !email || !key) {
    const missing = [
      !sheetId && "GOOGLE_SHEET_ID",
      !email && "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      !key && "GOOGLE_PRIVATE_KEY",
    ]
      .filter(Boolean)
      .join(", ");
    console.warn(`[GoogleSheets] missing env vars; skipping sheet log (missing: ${missing})`);
    return;
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const row = [
      entry.createdAt,
      entry.source,
      entry.name,
      entry.phone,
      entry.service,
      entry.preferredDate,
      entry.preferredTime,
      entry.location,
      entry.urgency,
      entry.leadScore,
      entry.intent,
      entry.notes,
      entry.conversationSummary,
      entry.status,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "Sheet1!A:N",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });

    console.log("[Sheets] Logged lead for", entry.phone);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Sheets] Failed to log (non-fatal): ${msg}`);
  }
}
