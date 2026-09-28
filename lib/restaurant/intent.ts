// Restaurant-mode intent detection and reservation-detail extraction.
//
// Deterministic and local: nothing here calls a model or leaves the process. The
// clinic slot extractor (lib/slotExtractor.ts) is NOT used in restaurant mode — this
// module only knows about reservations (date, time, party size), takeaway orders,
// and "everything else is an information question".
//
// Extracted values are kept as the customer wrote them ("yarın", "Cumartesi",
// "akşam 8", "4") rather than resolved to calendar dates. The owner reads them
// together with the message timestamp; resolving "cumartesi" to a date here would
// add a timezone/week-boundary bug surface for no gain.

export type RestaurantIntent = "reservation" | "order" | "info";

export interface ReservationDetails {
  date?: string;
  time?: string;
  partySize?: string;
}

export type ReservationField = "date" | "time" | "partySize";

// ── Normalization ─────────────────────────────────────────────────────────────

const FOLD: Record<string, string> = {
  ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c", â: "a", î: "i", û: "u", "’": "'", "‘": "'",
};

/**
 * Lowercases with Turkish rules and folds Turkish letters to ASCII, so "Yarın AKŞAM"
 * and "yarin aksam" match the same pattern. Iterates by code point and maps each to
 * exactly one replacement of the same UTF-16 length for the folded letters, so for
 * ordinary text the output is index-aligned with the input (see sliceOriginal).
 */
export function foldTurkish(text: string): string {
  const lower = text.toLocaleLowerCase("tr-TR");
  let out = "";
  for (const ch of lower) out += FOLD[ch] ?? ch;
  return out;
}

// Returns the customer's own spelling for a span found in the folded text. Falls back
// to the folded span in the rare case lowercasing changed the string length.
function sliceOriginal(original: string, folded: string, start: number, end: number): string {
  const src = original.length === folded.length ? original : folded;
  return src.slice(start, end).trim();
}

// Blanks a matched span (same length) so later extractors cannot re-read it — e.g. the
// "12.10" of a date is never parsed again as the time 12:10.
function mask(folded: string, start: number, end: number): string {
  return folded.slice(0, start) + " ".repeat(end - start) + folded.slice(end);
}

// ── Intent ────────────────────────────────────────────────────────────────────

const RESERVATION_RES: RegExp[] = [
  /\brezervasyon\w*/,
  /\brezerve\b/,
  /\breserv(?:ation|e)\w*/,
  /\bbook(?:ing)?\s+a\s+table\b/,
  /\btable\s+for\b/,
  /\byer\s+ayir\w*/,
  /\bmasa(?:ya|yi|niz|nizi|miz|lik|lar\w*)?\b/,
  /\byer\s+(?:var|bulunur)\s*mi\b/,
];

const ORDER_RES: RegExp[] = [
  /\bpaket\w*/,
  /\bsiparis\w*/,
  /\beve\s+(?:servis|siparis|gonder\w*|getir\w*|teslim\w*)/,
  /\b(?:kurye|teslimat|delivery|takeaway|take\s+away|yemeksepeti|gel\s+al)\b/,
  /\btrendyol\s*yemek\b/,
  /\bgetir\s*yemek\b/,
  /\border\b/,
];

const CANCEL_RE = /\b(?:vazgec\w*|iptal\w*|bosver\w*|gerek\s+yok|istemiyorum|cancel)\b/;

/**
 * Classifies one customer message. Priority: an explicit reservation word wins over
 * an order word ("rezervasyon" is unambiguous; "paket" inside a reservation message
 * is rare), an order word wins over an implicit reservation, and a message that
 * carries a party size plus a day or time ("Cumartesi 4 kişi gelebilir miyiz?") is
 * an implicit reservation. Everything else is an information question.
 */
export function detectRestaurantIntent(text: string): RestaurantIntent {
  const f = foldTurkish(text);
  if (RESERVATION_RES.some((re) => re.test(f))) return "reservation";
  if (ORDER_RES.some((re) => re.test(f))) return "order";
  const d = extractReservationDetails(text);
  if (d.partySize && (d.date || d.time)) return "reservation";
  return "info";
}

/** True when the customer is calling off an in-progress reservation request. */
export function isCancelMessage(text: string): boolean {
  return CANCEL_RE.test(foldTurkish(text));
}

// ── Party size ────────────────────────────────────────────────────────────────

const WORD_NUMBERS: Record<string, number> = {
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10,
  onbir: 11, "on bir": 11, oniki: 12, "on iki": 12, yirmi: 20,
};

const GROUP_WORDS: Record<string, number> = {
  ikimiz: 2, ucumuz: 3, dordumuz: 4, besimiz: 5, altimiz: 6,
};

interface Hit {
  value: string;
  start: number;
  end: number;
}

function findPartySize(original: string, f: string): Hit | null {
  // "2 yetişkin 1 çocuk" — kept verbatim, the owner needs the split.
  let m = /\b\d{1,2}\s*yetiskin\w*(?:\s*(?:ve|,|\+)?\s*\d{1,2}\s*cocuk\w*)?/.exec(f);
  if (m) return { value: sliceOriginal(original, f, m.index, m.index + m[0].length), start: m.index, end: m.index + m[0].length };

  m = /\b(\d{1,3})\s*(?:kisi\w*|people|persons?|pax|guests?)\b/.exec(f);
  if (m && Number(m[1]) > 0) return { value: String(Number(m[1])), start: m.index, end: m.index + m[0].length };

  m = /\b(on\s+bir|on\s+iki|onbir|oniki|yirmi|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on)\s*kisi\w*/.exec(f);
  if (m) {
    const n = WORD_NUMBERS[m[1].replace(/\s+/g, " ")];
    if (n) return { value: String(n), start: m.index, end: m.index + m[0].length };
  }

  m = /\b(ikimiz|ucumuz|dordumuz|besimiz|altimiz)\b/.exec(f);
  if (m) return { value: String(GROUP_WORDS[m[1]]), start: m.index, end: m.index + m[0].length };

  m = /\b(?:table\s+)?for\s+(\d{1,2})\b(?!\s*(?:am|pm|:|\.|'|o'?clock))/.exec(f);
  if (m && Number(m[1]) > 0) return { value: String(Number(m[1])), start: m.index, end: m.index + m[0].length };

  return null;
}

// ── Date ──────────────────────────────────────────────────────────────────────

const MONTHS =
  "ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|" +
  "january|february|march|april|may|june|july|august|september|october|november|december";

function findDate(original: string, f: string): Hit | null {
  // dd.mm(.yyyy) / dd/mm — unless it reads as a clock time ("saat 10.12").
  const numeric = /\b(0?[1-9]|[12]\d|3[01])\s*[./-]\s*(0?[1-9]|1[0-2])(?:\s*[./-]\s*\d{2,4})?\b/g;
  let m: RegExpExecArray | null;
  while ((m = numeric.exec(f)) !== null) {
    if (/saat\s*$/.test(f.slice(Math.max(0, m.index - 6), m.index))) continue;
    return { value: sliceOriginal(original, f, m.index, m.index + m[0].length), start: m.index, end: m.index + m[0].length };
  }

  const patterns: RegExp[] = [
    new RegExp(`\\b(?:0?[1-9]|[12]\\d|3[01])\\s*(?:${MONTHS})\\w*`),
    /\b(?:(?:bu|onumuzdeki|gelecek|haftaya)\s+)?(?:pazartesi|sali|carsamba|persembe|cumartesi|cuma|pazar|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\w*/,
    /\b(?:bu\s+aksam|bu\s+gece|bugun|yarin|obur\s+gun|ertesi\s+gun|hafta\s*sonu|today|tonight|tomorrow)\b/,
  ];
  for (const re of patterns) {
    m = re.exec(f);
    if (m) return { value: sliceOriginal(original, f, m.index, m.index + m[0].length), start: m.index, end: m.index + m[0].length };
  }
  return null;
}

// ── Time ──────────────────────────────────────────────────────────────────────

// Hour 0-23. "2[0-3]" is tried BEFORE "[01]?\d" and a digit may not follow: with the
// other order an optional tail lets "saat 20.00" stop at "saat 2".
const HOUR = "(?:2[0-3]|[01]?\\d)(?!\\d)";

function findTime(original: string, f: string): Hit | null {
  const patterns: RegExp[] = [
    new RegExp(`\\b${HOUR}:[0-5]\\d\\b`),
    new RegExp(`\\bsaat\\s*${HOUR}(?:\\s*[:.]\\s*[0-5]\\d)?(?:\\s*bucuk)?`),
    new RegExp(`\\b(?:sabah|ogleden\\s+sonra|oglen|ogle|aksam|gece)\\s*(?:saat\\s*)?${HOUR}(?:\\s*[:.]\\s*[0-5]\\d)?(?:\\s*bucuk)?`),
    // hh.mm — a date-shaped value (valid dd.mm) was already taken and masked by findDate.
    new RegExp(`\\b${HOUR}\\.[0-5]\\d\\b`),
    /\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:am|pm)\b/,
    new RegExp(`\\b${HOUR}\\s*'?\\s*(?:de|da|te|ta)\\b`),
    new RegExp(`\\b${HOUR}\\s*(?:gibi|civari|sularinda|bucuk)\\b`),
  ];
  for (const re of patterns) {
    const m = re.exec(f);
    if (m) return { value: sliceOriginal(original, f, m.index, m.index + m[0].length), start: m.index, end: m.index + m[0].length };
  }
  return null;
}

// ── Public extraction ─────────────────────────────────────────────────────────

/**
 * Extracts whatever reservation details this message carries. `awaiting` is the field
 * the bot asked for last turn: a bare answer ("4", "20:00", "8") is only meaningful
 * in that context, so it is accepted for that field alone.
 */
export function extractReservationDetails(
  text: string,
  awaiting?: ReservationField
): ReservationDetails {
  const out: ReservationDetails = {};
  let f = foldTurkish(text);

  const party = findPartySize(text, f);
  if (party) {
    out.partySize = party.value;
    f = mask(f, party.start, party.end);
  }
  const date = findDate(text, f);
  if (date) {
    out.date = date.value;
    f = mask(f, date.start, date.end);
  }
  const time = findTime(text, f);
  if (time) out.time = time.value;

  const bare = text.trim();
  if (awaiting === "partySize" && !out.partySize) {
    const m = /^(\d{1,3})$/.exec(bare);
    if (m && Number(m[1]) > 0) out.partySize = String(Number(m[1]));
  }
  if (awaiting === "time" && !out.time) {
    if (/^(?:[01]?\d|2[0-3])(?:[:.][0-5]\d)?$/.test(bare)) out.time = bare;
  }
  return out;
}

/** "4" → "4 kişi"; a composite value ("2 yetişkin 1 çocuk") is shown as written. */
export function formatPartySize(partySize: string): string {
  return /^\d+$/.test(partySize) ? `${partySize} kişi` : partySize;
}
