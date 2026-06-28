export const SMS_MAX_CHARS = 120;

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

function sanitizeBase(text: string): string {
  let s = text;

  s = s.replace(/['']/g, "\x27");
  s = s.replace(/[""]/g, "\x22");

  for (const [pattern, replacement] of CONTRACTIONS) {
    s = s.replace(pattern, replacement);
  }

  s = s.replace(/\x27/g, "");

  s = s.replace(/[—–―]/g, "-");
  s = s.replace(/…/g, "...");
  s = s.replace(/[\r\n\t]+/g, " ");

  // Keep printable ASCII and Turkish letters
  s = s.replace(new RegExp(`[^\\x20-\\x7E${TURKISH_CHARS}]`, "g"), "");

  s = s.replace(/ {2,}/g, " ").trim();

  return s;
}

// Filters characters but does NOT truncate — use for AI replies stored in history
// or returned to non-SMS endpoints. SMS truncation is applied only at send time.
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

export function sanitizeSmsText(text: string): string {
  const s = sanitizeBase(text);
  return s.length > SMS_MAX_CHARS ? s.slice(0, SMS_MAX_CHARS) : s;
}
