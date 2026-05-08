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

export interface LogEntry {
  timestamp: string;
  messageSid: string;
  from: string;
  to: string;
  customerMessage: string;
  aiReply: string;
  ownerNotified: boolean;
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
    console.warn(`[Sheets] Skipping log — missing env vars: ${missing}`);
    return;
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const row = [
      entry.timestamp,
      entry.messageSid,
      entry.from,
      entry.to,
      entry.customerMessage,
      entry.aiReply,
      entry.ownerNotified ? "YES" : "NO",
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "Sheet1!A:G",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });

    console.log("[Sheets] Logged interaction for", entry.from);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Sheets] Failed to log (non-fatal): ${msg}`);
  }
}
