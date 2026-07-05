/**
 * Nurabla Karadeniz Restaurant — pilot business config + intent logic.
 *
 * This module is intentionally self-contained and has NO dependency on the
 * clinic / laser conversation pipeline. It holds Nurabla's static business
 * information plus the pure functions used by the isolated WhatsApp webhook
 * at app/api/whatsapp/nurabla/route.ts.
 *
 * The restaurant operates multiple branches; each branch has its own address
 * and Google Maps link, while the menu is shared across branches. Location
 * replies list a fixed set of branches — we never ask the user to choose.
 */

export type NurablaBranchKey = "cekmekoy" | "umraniye" | "basaksehir";

export interface NurablaBranch {
  /** Display name (Turkish), used in location replies. */
  name: string;
  address: string;
  mapsUrl: string;
  /** Branch phone number. Optional — only active branches publish one. */
  phone?: string;
}

export interface NurablaBusiness {
  name: string;
  menuUrl: string;
  branches: Record<NurablaBranchKey, NurablaBranch>;
}

export const NURABLA: NurablaBusiness = {
  name: "Nurabla Karadeniz Restaurant",
  menuUrl: "https://www.nurabla.com.tr/menu/",
  branches: {
    cekmekoy: {
      name: "Çekmeköy",
      address: "Merkez Mahallesi, Nefer Sokak No:15, 34782 Çekmeköy/İstanbul",
      mapsUrl:
        "https://www.google.com/maps/search/?api=1&query=Nur+Abla+Karadeniz+Sofrası+Çekmeköy",
      phone: "0216 642 53 10",
    },
    umraniye: {
      name: "Ümraniye",
      address:
        "Fatih Sultan Mehmet, Balkan Caddesi Meydan İstanbul AVM No: 62, 34770 Ümraniye/İstanbul",
      mapsUrl:
        "https://www.google.com/maps/search/?api=1&query=Nur+Abla+Karadeniz+Sofrası+Ümraniye",
    },
    basaksehir: {
      name: "Başakşehir",
      address:
        "Ziya Gökalp Mah., Süleyman Demirel Bulv. Mall of İstanbul AVM No: 523, 34490 Başakşehir/İstanbul",
      mapsUrl:
        "https://www.google.com/maps/search/?api=1&query=Nur+Abla+Karadeniz+Sofrası+Başakşehir",
      phone: "0212 809 01 77",
    },
  },
};

/**
 * Branches included in a location reply, in display order. Ümraniye is
 * intentionally omitted from location replies.
 */
const LOCATION_BRANCH_KEYS: NurablaBranchKey[] = ["cekmekoy", "basaksehir"];

/**
 * Reply sent when we cannot confidently answer — never invent information.
 * Directs the customer to the active branch phone numbers instead.
 */
export const NURABLA_FALLBACK =
  "Bu konuda Nurabla ekibimiz size yardımcı olabilir.\n\n" +
  LOCATION_BRANCH_KEYS.map((key) => {
    const branch = NURABLA.branches[key];
    return `📞 ${branch.name}: ${branch.phone}`;
  }).join("\n");

// ── Intent detection ──────────────────────────────────────────────────────────
//
// Detection tolerates informal Turkish, missing Turkish characters, and common
// typos. Text is normalized to lowercase ASCII, then matched in two passes:
//   1. multi-word phrases (highest priority, exact substring), then
//   2. single keywords (token substring, plus controlled fuzzy matching).
// Keywords are stored in ASCII-folded form so Turkish and ASCII spellings
// ("menü" / "menu") collapse to the same token.

/** Multi-word phrases that signal a location request. */
const LOCATION_PHRASES = [
  "yol tarifi",
  "nasil gelirim",
  "nasil giderim",
  "hangi tarafta",
  "yer neresi",
  "yeriniz nerede",
  "mekan nerede",
];

/** Single-word keywords (fuzzy-matchable) that signal a location request. */
const LOCATION_KEYWORDS = [
  "konum",
  "adres",
  "nerede",
  "nerde",
  "neresi",
  "harita",
  "lokasyon",
  "location",
  "mekan",
];

/** Multi-word phrases that signal a menu request. */
const MENU_PHRASES = ["ne kadar", "ne var", "neler var"];

/** Single-word keywords (fuzzy-matchable) that signal a menu request. */
const MENU_KEYWORDS = [
  "menu",
  "fiyat",
  "ucret",
  "yemek",
  "kahvalti",
  "cesit",
  "urun",
  "liste",
];

/**
 * Generic words that must never fuzzy-match a keyword — they are too short and
 * too common, and would cause false positives (e.g. "var" in "rezervasyon var").
 * All are shorter than the fuzzy floor anyway; the set documents the intent.
 */
const GENERIC_WORDS = new Set(["yer", "ne", "var", "at"]);

/** Turkish characters folded to their closest ASCII form. */
const TURKISH_ASCII_FOLD: Record<string, string> = {
  ç: "c",
  ğ: "g",
  ı: "i",
  i̇: "i",
  î: "i",
  ö: "o",
  ş: "s",
  ü: "u",
  û: "u",
  â: "a",
};

/**
 * Normalize incoming text for matching: Turkish-locale lowercase, fold Turkish
 * characters to ASCII (so "menü" and "menu" collapse), strip punctuation,
 * collapse repeated whitespace, and trim.
 */
function normalizeNurablaText(text: string): string {
  const lowered = (text ?? "").toLocaleLowerCase("tr-TR");
  let folded = "";
  for (const ch of lowered) {
    folded += TURKISH_ASCII_FOLD[ch] ?? ch;
  }
  return folded
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Damerau–Levenshtein edit distance (optimal string alignment) — counts an
 * adjacent transposition (e.g. "fiayt" → "fiyat") as a single edit.
 */
function editDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  const d: number[][] = Array.from({ length: al + 1 }, () =>
    new Array<number>(bl + 1).fill(0)
  );
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[al][bl];
}

/**
 * Fuzzy edit-distance budget for a keyword: none below 4 characters, 1 for
 * 4–6 characters, 2 for longer keywords.
 */
function fuzzyBudget(length: number): number {
  if (length < 4) return 0;
  if (length <= 6) return 1;
  return 2;
}

/** Whether a single token matches a keyword exactly, by substring, or fuzzily. */
function tokenMatchesKeyword(token: string, keyword: string): boolean {
  if (token === keyword) return true;
  // Substring covers inflected suffixes: "fiyatlar" ⊃ "fiyat", "menuyu" ⊃ "menu".
  if (keyword.length >= 4 && token.includes(keyword)) return true;

  const budget = fuzzyBudget(keyword.length);
  if (budget === 0 || GENERIC_WORDS.has(token)) return false;
  return editDistance(token, keyword) <= budget;
}

export interface NurablaIntent {
  location: boolean;
  menu: boolean;
}

/**
 * Detect whether the message asks for location and/or menu information.
 * Phrase matching is evaluated before single-keyword matching.
 */
export function detectNurablaIntent(body: string): NurablaIntent {
  const normalized = normalizeNurablaText(body);
  if (!normalized) {
    return { location: false, menu: false };
  }

  const tokens = normalized.split(" ");
  const phraseHit = (phrases: string[]): boolean =>
    phrases.some((phrase) => normalized.includes(phrase));
  const keywordHit = (keywords: string[]): boolean =>
    tokens.some((token) =>
      keywords.some((keyword) => tokenMatchesKeyword(token, keyword))
    );

  return {
    location: phraseHit(LOCATION_PHRASES) || keywordHit(LOCATION_KEYWORDS),
    menu: phraseHit(MENU_PHRASES) || keywordHit(MENU_KEYWORDS),
  };
}

function branchLocationText(key: NurablaBranchKey): string {
  const branch = NURABLA.branches[key];
  return (
    `${branch.name} şubemizin konumu:\n` +
    `Adres: ${branch.address}\n` +
    `Google Haritalar: ${branch.mapsUrl}`
  );
}

/** Location reply listing every branch in {@link LOCATION_BRANCH_KEYS}. */
function locationText(): string {
  return LOCATION_BRANCH_KEYS.map(branchLocationText).join("\n\n");
}

function menuText(): string {
  return `Menümüz: ${NURABLA.menuUrl}`;
}

/**
 * Build the plain-text reply for an incoming message.
 *
 * - Location → the Çekmeköy and Başakşehir addresses and maps links.
 * - Menu only → the menu link.
 * - Menu + location → the menu link followed by both branch locations.
 * - Neither intent (including empty input) → the phone fallback.
 */
export function buildNurablaReply(body: string): string {
  const { location, menu } = detectNurablaIntent(body);

  if (location && menu) {
    return `${menuText()}\n\n${locationText()}`;
  }
  if (location) {
    return locationText();
  }
  if (menu) {
    return menuText();
  }
  return NURABLA_FALLBACK;
}
