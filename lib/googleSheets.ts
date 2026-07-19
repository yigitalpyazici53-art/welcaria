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

export interface LogToSheetResult {
  skipped: boolean;
  missingVars?: string[];
  error?: string;
}

export async function logToSheet(entry: LogEntry): Promise<LogToSheetResult> {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;

  if (!sheetId || !email || !key) {
    const missing = [
      !sheetId && "GOOGLE_SHEET_ID",
      !email && "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      !key && "GOOGLE_PRIVATE_KEY",
    ].filter(Boolean) as string[];
    console.warn(`[GoogleSheets] missing env vars; skipping sheet log (missing: ${missing.join(", ")})`);
    return { skipped: true, missingVars: missing };
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
    return { skipped: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Sheets] Failed to log (non-fatal): ${msg}`);
    return { skipped: false, error: msg };
  }
}

// Phone numbers reach the sheet in several transport forms ("+15556610104",
// "15556610104", "whatsapp:+15556610104"). Compare on digits only so an erasure
// request keyed by any one form matches the stored row, without over-matching.
function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export interface DeleteLeadResult {
  skipped: boolean;
  missingVars?: string[];
  deletedRows: number;
  error?: string;
}

/**
 * KVKK erasure: delete every row whose phone column matches `phone` (compared on
 * digits only). Returns { deletedRows: 0 } gracefully when there is no match or
 * when Sheets is not configured — never throws for those cases. The phone column
 * is column D (index 3): created_at | source | name | phone | ...
 */
export async function deleteLeadFromSheets(phone: string): Promise<DeleteLeadResult> {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;

  if (!sheetId || !email || !key) {
    const missing = [
      !sheetId && "GOOGLE_SHEET_ID",
      !email && "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      !key && "GOOGLE_PRIVATE_KEY",
    ].filter(Boolean) as string[];
    console.warn(`[GoogleSheets] missing env vars; skipping sheet delete (missing: ${missing.join(", ")})`);
    return { skipped: true, missingVars: missing, deletedRows: 0 };
  }

  const targetDigits = phoneDigits(phone);
  if (!targetDigits) return { skipped: false, deletedRows: 0 };

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Read the rows to locate matches by phone (column index 3).
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Sheet1!A:N",
    });
    const rows = res.data.values ?? [];

    const matchIndices: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const cell = (rows[i]?.[3] ?? "").toString();
      const cellDigits = phoneDigits(cell);
      if (cellDigits && cellDigits === targetDigits) matchIndices.push(i);
    }

    if (matchIndices.length === 0) {
      console.log(`[Sheets] erasure: no rows matched (${targetDigits.length} digits)`);
      return { skipped: false, deletedRows: 0 };
    }

    // Resolve the numeric sheetId (gid) of the "Sheet1" tab for deleteDimension.
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const tab = meta.data.sheets?.find((s) => s.properties?.title === "Sheet1");
    const gid = tab?.properties?.sheetId;
    if (gid === undefined || gid === null) {
      return { skipped: false, deletedRows: 0, error: "Sheet1 tab not found" };
    }

    // Delete bottom-to-top so earlier deletions do not shift later row indices.
    const requests = matchIndices
      .sort((a, b) => b - a)
      .map((i) => ({
        deleteDimension: {
          range: { sheetId: gid, dimension: "ROWS" as const, startIndex: i, endIndex: i + 1 },
        },
      }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests },
    });

    console.log(`[Sheets] erasure: deleted ${matchIndices.length} row(s)`);
    return { skipped: false, deletedRows: matchIndices.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Sheets] erasure failed: ${msg}`);
    return { skipped: false, deletedRows: 0, error: msg };
  }
}

export async function readLeadsForDateRange(from: Date, to: Date): Promise<LogEntry[]> {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;

  if (!sheetId || !email || !key) {
    console.warn("[Sheets] readLeadsForDateRange: missing env vars, returning []");
    return [];
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Sheet1!A:N",
    });

    const rows = res.data.values ?? [];
    const fromMs = from.getTime();
    const toMs = to.getTime();

    return rows
      .filter((row) => {
        const ts = Date.parse(row[0]);
        return !isNaN(ts) && ts >= fromMs && ts <= toMs;
      })
      .map(
        (row): LogEntry => ({
          createdAt:           row[0]  ?? "",
          source:              row[1]  ?? "",
          name:                row[2]  ?? "",
          phone:               row[3]  ?? "",
          service:             row[4]  ?? "",
          preferredDate:       row[5]  ?? "",
          preferredTime:       row[6]  ?? "",
          location:            row[7]  ?? "",
          urgency:             row[8]  ?? "",
          leadScore:           row[9]  ?? "",
          intent:              row[10] ?? "",
          notes:               row[11] ?? "",
          conversationSummary: row[12] ?? "",
          status:              row[13] ?? "",
        })
      );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Sheets] readLeadsForDateRange failed: ${msg}`);
    return [];
  }
}
