// Deterministic "no invented facts" check for restaurant-mode model replies.
//
// The prompt tells the model to answer only from RESTAURANT_INFO_TEXT. That is a soft
// control. This is the hard one for the facts that do the most damage when invented:
// prices and opening hours. Every clock time and every number in the reply must
// literally appear in the approved sources (the info text, plus what the customer
// typed — "4 kişi için" may be echoed back). A single unknown figure rejects the whole
// reply and the conversation is handed to the business instead.
//
// Deliberately strict: a false rejection costs one human handoff; a false acceptance
// sends a customer to a closed door or quotes a wrong price.
//
// NOT covered, stated plainly: invented dish NAMES, day names ("Pazartesi kapalıyız")
// and numbers written out as words ("dokuzda") cannot be verified this way. Those rely
// on the prompt rule alone.

const TIME_RE = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;
const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
// A number written with spaces/dashes inside (phone numbers: "0216 642 53 10").
const SPACED_NUMBER_RE = /\d[\d .,-]*\d/g;

function normalizeTime(h: string, m: string): string {
  return `${Number(h)}:${m}`;
}

// "1.250" / "1,250" / "1250" → "1250"; a zero decimal tail ("250,00") is dropped so
// it matches "250". A non-zero tail stays significant ("12,50" → "1250").
function normalizeNumber(raw: string): string {
  return raw.replace(/[.,]00$/, "").replace(/[.,]/g, "");
}

function collect(sources: string[]): { times: Set<string>; numbers: Set<string> } {
  const times = new Set<string>();
  const numbers = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(TIME_RE)) times.add(normalizeTime(m[1], m[2]));
    for (const m of src.matchAll(NUMBER_RE)) numbers.add(normalizeNumber(m[0]));
    for (const m of src.matchAll(SPACED_NUMBER_RE)) numbers.add(m[0].replace(/\D/g, ""));
  }
  return { times, numbers };
}

/**
 * Returns the times/numbers in `reply` that do not appear in any source. Empty array
 * means the reply is grounded (as far as figures go).
 */
export function findUngroundedFacts(reply: string, sources: string[]): string[] {
  const { times, numbers } = collect(sources);
  const bad: string[] = [];

  // Times first, then blank them out so "22:00" is not re-checked as "22" and "00".
  const rest = reply.replace(TIME_RE, (whole, h: string, m: string) => {
    if (!times.has(normalizeTime(h, m))) bad.push(whole);
    return " ";
  });

  for (const m of rest.matchAll(NUMBER_RE)) {
    if (!numbers.has(normalizeNumber(m[0]))) bad.push(m[0]);
  }

  return bad;
}
