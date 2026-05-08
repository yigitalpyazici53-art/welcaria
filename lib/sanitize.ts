export const SMS_MAX_CHARS = 120;

// \x27 = ASCII apostrophe — used to build contraction patterns so the source
// file never risks containing a Unicode curly-quote in a string literal.
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
  [new RegExp("\\bI" + APO + "m\\b", "g"), "I am"],
  [new RegExp("\\bI" + APO + "ll\\b", "g"), "I will"],
  [new RegExp("\\bI" + APO + "ve\\b", "g"), "I have"],
  [new RegExp("\\bI" + APO + "d\\b", "g"), "I would"],
  [new RegExp("\\bwe" + APO + "re\\b", "gi"), "we are"],
  [new RegExp("\\bwe" + APO + "ll\\b", "gi"), "we will"],
  [new RegExp("\\bwe" + APO + "ve\\b", "gi"), "we have"],
  [new RegExp("\\bwe" + APO + "d\\b", "gi"), "we would"],
  [new RegExp("\\byou" + APO + "re\\b", "gi"), "you are"],
  [new RegExp("\\byou" + APO + "ll\\b", "gi"), "you will"],
  [new RegExp("\\byou" + APO + "ve\\b", "gi"), "you have"],
  [new RegExp("\\byou" + APO + "d\\b", "gi"), "you would"],
  [new RegExp("\\bthey" + APO + "re\\b", "gi"), "they are"],
  [new RegExp("\\bthey" + APO + "ll\\b", "gi"), "they will"],
  [new RegExp("\\bit" + APO + "s\\b", "gi"), "it is"],
  [new RegExp("\\bthat" + APO + "s\\b", "gi"), "that is"],
  [new RegExp("\\bwhat" + APO + "s\\b", "gi"), "what is"],
  [new RegExp("\\bthere" + APO + "s\\b", "gi"), "there is"],
  [new RegExp("\\bhere" + APO + "s\\b", "gi"), "here is"],
  [new RegExp("\\blet" + APO + "s\\b", "gi"), "let us"],
  [new RegExp("\\bwho" + APO + "s\\b", "gi"), "who is"],
  [new RegExp("\\bhe" + APO + "s\\b", "gi"), "he is"],
  [new RegExp("\\bshe" + APO + "s\\b", "gi"), "she is"],
];

export function sanitizeSmsText(text: string): string {
  let s = text;

  // Smart/curly single quotes (U+2018, U+2019) -> ASCII apostrophe
  s = s.replace(/[‘’]/g, "\x27");
  // Smart/curly double quotes (U+201C, U+201D) -> ASCII double-quote
  s = s.replace(/[“”]/g, "\x22");

  // Expand contractions before stripping apostrophes
  for (const [pattern, replacement] of CONTRACTIONS) {
    s = s.replace(pattern, replacement);
  }

  // Remove remaining apostrophes (possessives, missed contractions)
  s = s.replace(/\x27/g, "");

  // Em dash (U+2014), en dash (U+2013), horizontal bar (U+2015) -> hyphen
  s = s.replace(/[—–―]/g, "-");

  // Unicode ellipsis (U+2026) -> three dots
  s = s.replace(/…/g, "...");

  // Newlines and tabs -> space (before non-ASCII strip)
  s = s.replace(/[\r\n\t]+/g, " ");

  // Strip emojis and all remaining non-ASCII (keep printable ASCII 0x20-0x7E)
  s = s.replace(/[^\x20-\x7E]/g, "");

  // Collapse multiple spaces
  s = s.replace(/ {2,}/g, " ").trim();

  // Hard-cap at 90 chars - no ellipsis appended (would push over limit)
  if (s.length > SMS_MAX_CHARS) {
    s = s.slice(0, SMS_MAX_CHARS);
  }

  return s;
}
