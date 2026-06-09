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

export function sanitizeSmsText(text: string): string {
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

  if (s.length > SMS_MAX_CHARS) {
    s = s.slice(0, SMS_MAX_CHARS);
  }

  return s;
}
