import type { ConversationState, UrgencyLevel, LeadScore } from "./conversationState";

export interface ExtractedSlots {
  name?: string;
  phone?: string;
  service?: string;
  preferredDate?: string;
  preferredTime?: string;
  location?: string;
  urgency?: UrgencyLevel;
  source?: string;
  notes?: string;
  leadScore?: LeadScore;
}

// Turkish mobile number: starts with 05xx or +905xx
const PHONE_PATTERN =
  /(?:\+90|0)[\s\-]?(?:5\d{2})[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/;

// Turkish day and date patterns — order matters: specific before generic
const DATE_PATTERNS: RegExp[] = [
  /\b\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?\b/,
  /\b\d{1,2}\s+(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\b/i,
  /\b(bugün|bu gün|yarın|öbür gün|öbürgün)\b/i,
  /\b(pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)\b/i,
  /\bbu hafta\b/i,
];

const TIME_PATTERNS: RegExp[] = [
  /\b\d{1,2}:\d{2}\b/,                          // 14:00, 9:00
  /\bsaat\s*\d{1,2}(?:[.,]\d{2})?\b/i,         // saat 3, saat 15, saat 15.30
  // No \b around Turkish chars (ö, ğ not in \w): reorder longer before shorter to avoid partial match
  /(sabah erken|öğleden sonra|öğle|akşam üstü|akşam|gece yarısı|gece)/i,
  /(sabah|öğleden sonra|öğle|akşam)/i,
];

const URGENCY_PATTERNS: Array<[RegExp, UrgencyLevel]> = [
  [/\b(acil|ivedi|acele|hemen|şimdi|derhal|bugün mutlaka|bekleyemem)\b/i, "high"],
  [/\b(bu hafta|yakında|kısa sürede|en kısa sürede|mümkün olan en kısa)\b/i, "medium"],
  [/\b(acele değil|acele yok|uygun olduğunda|ne zaman uygunsa|fırsat buldukça)\b/i, "low"],
];

// Service offerings — most specific patterns first to avoid partial matches.
// Turkish chars (ş, ğ, ü, ö, ı) are not in \w, so \b is unreliable around them;
// use specific phrases instead.
const SERVICE_PATTERNS: Array<[RegExp, string]> = [
  // Hair — compound/specific before generic
  [/saç\s+kaynak(?:lama)?/i, "saç kaynaklama"],
  [/gelin\s+saç/i, "gelin saçı"],
  [/keratin\s+bak/i, "keratin bakımı"],
  [/dip\s+boya/i, "dip boya"],
  [/saç\s+boyama/i, "saç boyama"],
  [/saç\s+kesim/i, "saç kesimi"],
  [/saç\s+bak/i, "saç bakımı"],
  [/röfle/i, "röfle"],
  [/ombre/i, "ombre"],
  [/fön/i, "fön"],
  // Brow & lash
  [/mikroblading/i, "mikroblading"],
  [/kirpik\s+lifting|lash\s+lift/i, "kirpik lifting"],
  [/ipek\s+kirpik/i, "ipek kirpik"],
  [/kaş\s+tasarım|kaş\s+laminasyon|brow/i, "kaş tasarımı"],
  [/kaş\s+(?:alma|aldırma)/i, "kaş alma"],
  [/kirpik\s+(?:lamine|boya)/i, "kirpik bakımı"],
  // Skin
  [/cilt\s+bak|yüz\s+bak|facial/i, "cilt bakımı"],
  // Nails
  [/protez\s+tırnak/i, "protez tırnak"],
  [/kalıcı\s+(?:oje|manikür)|gel\s+manikür/i, "kalıcı manikür"],
  [/manikür|manicure/i, "manikür"],
  [/pedikür|pedicure/i, "pedikür"],
  // Waxing
  [/ağda|\bwax\b/i, "ağda"],
  // Makeup
  [/makyaj/i, "makyaj"],
  // Other service verticals
  [/lazer\s+epilasyon|epilasyon|\blazer\b/i, "lazer epilasyon"],
  [/botoks?|dolgu|filler/i, "estetik uygulama"],
  [/masaj|massage|terapi/i, "masaj"],
  // "diş" ends in ş (non-\w) so trailing \b fails — use (?!\w) lookahead
  [/diş\s+(?:beyazlatma|kaplama)|veneer|zirkonyum|implant|\bdiş(?!\w)/i, "diş tedavisi"],
  [/oto\s+detay|araç\s+(?:yıkama|detay|bakım)|car\s+(?:detail|wash)/i, "oto detay"],
  [/sakal|tıraş|erkek\s+bakım|barber/i, "erkek bakımı"],
  [/hairstyle|haircut/i, "saç kesimi"],
];

// Known Istanbul districts and common Turkish cities for fallback location matching
const KNOWN_LOCATIONS: Record<string, string> = {
  "kadıköy":    "Kadıköy",
  "ataşehir":   "Ataşehir",
  "ümraniye":   "Ümraniye",
  "nişantaşı":  "Nişantaşı",
  "beşiktaş":   "Beşiktaş",
  "şişli":      "Şişli",
  "fatih":      "Fatih",
  "üsküdar":    "Üsküdar",
  "bakırköy":   "Bakırköy",
  "beyoğlu":    "Beyoğlu",
  "sarıyer":    "Sarıyer",
  "maltepe":    "Maltepe",
  "kartal":     "Kartal",
  "pendik":     "Pendik",
  "tuzla":      "Tuzla",
  "bağcılar":   "Bağcılar",
  "mecidiyeköy": "Mecidiyeköy",
  "levent":     "Levent",
  "etiler":     "Etiler",
  "bebek":      "Bebek",
  "ortaköy":    "Ortaköy",
  "bostancı":   "Bostancı",
  "moda":       "Moda",
  "ankara":     "Ankara",
  "izmir":      "İzmir",
  "bursa":      "Bursa",
  "antalya":    "Antalya",
};

// Structural patterns for Turkish branch/location phrases.
// Tuple: [regex, capture group index]
// These run before the KNOWN_LOCATIONS fallback.
const LOCATION_PATTERNS: Array<[RegExp, number]> = [
  // "Şube: Ümraniye", "Sube: Ümraniye", "Konum: Ataşehir", "Lokasyon: Beşiktaş", "Adres: Kadıköy"
  [/(?:[ŞşSs]ube|[Kk]onum|[Ll]okasyon|[Aa]dres)\s*:\s*([A-ZÇĞİÖŞÜa-zçğışöü][A-Za-zÇĞİÖŞÜçğışöü]*)/, 1],
  // "Şube Ümraniye", "şube Ümraniye" (space only, no colon — capital guard prevents capturing "olarak")
  [/[ŞşSs]ube\s+([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+)/, 1],
  // "Kadıköy şubesi", "Ataşehir şubesini", "Nişantaşı şubesinde"
  [/([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+(?:\s+[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+)?)\s+şube/, 1],
  // "Konum Kadıköy", "konum Kadıköy"
  [/[Kk]onum\s+([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+)/, 1],
  // "Şube olarak Kadıköy", "şube olarak Kadıköy"
  [/[Şş]ube\s+olarak\s+([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+)/, 1],
  // "Nişantaşı tarafı olur", "Kadıköy yakın"
  [/([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+)\s+(?:tarafı|yakın)/, 1],
  // "Bana Kadıköy yakın", "bana Kadıköy"
  [/[Bb]ana\s+([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+)/, 1],
];

// Looks for explicit name introductions
const NAME_PATTERNS: RegExp[] = [
  // "İsim: Aylin", "isim: aylin", "Ad: Aylin", "Adım: Aylin"
  /(?:[İi]sim|[Aa]d(?:ım)?)\s*:\s*([A-ZÇĞİÖŞÜa-zçğışöüI][A-Za-zÇĞİÖŞÜçğışöü]*)/,
  /\b(?:ben|benim adım|ismim|adım)\s+([A-ZÇĞİÖŞÜa-zçğışöüI]{2,}(?:\s+[A-ZÇĞİÖŞÜa-zçğışöüI]{2,})?)\b/i,
  /^([A-ZÇĞİÖŞÜ][a-zçğışöü]{1,}(?:\s+[A-ZÇĞİÖŞÜ][a-zçğışöü]{1,})?)\s+(?:olarak|aradım|yazıyorum|merhaba)\b/,
];

// Words that must not be mistaken for a Turkish name in the bare-word fallback
const NAME_BLOCKLIST = new Set([
  // services
  "lazer", "epilasyon", "masaj", "manikür", "pedikür", "botoks", "dolgu", "wax", "ağda",
  "makyaj", "ombre", "röfle", "fön", "mikroblading", "kirpik", "protez", "keratin",
  // locations (lowercase)
  "kadıköy", "ataşehir", "nişantaşı", "beşiktaş", "şişli", "fatih", "üsküdar",
  "bakırköy", "beyoğlu", "sarıyer", "maltepe", "kartal", "pendik", "tuzla",
  "bağcılar", "mecidiyeköy", "levent", "etiler", "bebek", "ortaköy", "bostancı",
  "moda", "ankara", "izmir", "bursa", "antalya",
  // days
  "pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi", "pazar",
  // time-of-day / temporal
  "sabah", "öğle", "öğleden", "akşam", "gece", "bugün", "yarın", "hafta",
  // common words that could appear as a 1-2 word reply
  "merhaba", "selam", "tamam", "evet", "hayır", "ok", "tabi", "tabii",
  "güzel", "iyi", "kötü", "hemen", "şimdi", "bilgi", "şube", "randevu",
  "fiyat", "hizmet", "telefon", "numara", "lütfen", "teşekkür", "teşekkürler",
  "tüm", "vücut", "beni", "seni", "bize", "uygun", "olur", "var", "yok",
  "için", "ile", "ve", "veya", "sonra", "önce", "kadar", "gibi", "çok",
  "az", "biraz", "sadece", "ancak", "ama", "fakat", "hanım",
]);

// Pure Turkish/Latin letters, 1 or 2 words, no digits or punctuation
const BARE_NAME_RE = /^[A-ZÇĞİÖŞÜa-zçğışöü]{2,}(?:\s+[A-ZÇĞİÖŞÜa-zçğışöü]{2,})?$/;

// Self-introduction prefixes already covered by NAME_PATTERNS, but strip here too for safety
const NAME_INTRO_RE = /^(?:ben(?:\s+adım)?|benim\s+adım|ismim|adım|adı)\s+/i;

function turkishTitleCase(word: string): string {
  if (!word) return word;
  const first = word[0];
  const rest = word.slice(1).toLowerCase();
  // Turkish dotted-i rule: lowercase 'i' → uppercase 'İ' (not 'I')
  const upper = first === "i" ? "İ" : first === "ı" ? "I" : first.toUpperCase();
  return upper + rest;
}

/**
 * Bare-word name fallback for the collect_name stage.
 * Call ONLY when extractSlots() found no name and current stage is collect_name
 * (or the assistant just asked for a name).
 * Returns a title-cased name, or undefined if the message doesn't look like a name.
 */
export function extractNameFallback(message: string): string | undefined {
  const trimmed = message.trim();
  // Strip self-introduction prefixes before testing
  const stripped = trimmed.replace(NAME_INTRO_RE, "").trim();
  // Consider only first 2 words
  const words = stripped.split(/\s+/).slice(0, 2);
  const candidate = words.join(" ");

  if (!BARE_NAME_RE.test(candidate)) return undefined;
  if (words.some((w) => NAME_BLOCKLIST.has(w.toLowerCase()))) return undefined;

  return words.map(turkishTitleCase).join(" ");
}

function calculateLeadScore(slots: ExtractedSlots): LeadScore {
  const hasDateTime = !!(slots.preferredDate || slots.preferredTime);
  const hasService = !!slots.service;
  const isUrgent = slots.urgency === "high";

  if ((hasService && hasDateTime) || isUrgent) return "hot";
  if (hasService || hasDateTime) return "warm";
  return "cold";
}

export function extractSlots(message: string): ExtractedSlots {
  const result: ExtractedSlots = {};

  const phoneMatch = message.match(PHONE_PATTERN);
  if (phoneMatch) result.phone = phoneMatch[0].replace(/[\s\-]/g, "");

  for (const [pattern, service] of SERVICE_PATTERNS) {
    if (pattern.test(message)) {
      result.service = service;
      break;
    }
  }

  for (const pattern of DATE_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      result.preferredDate = match[0].toLowerCase().trim();
      break;
    }
  }

  for (const pattern of TIME_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      result.preferredTime = match[0].toLowerCase().trim();
      break;
    }
  }

  for (const [pattern, urgency] of URGENCY_PATTERNS) {
    if (pattern.test(message)) {
      result.urgency = urgency;
      break;
    }
  }

  for (const pattern of NAME_PATTERNS) {
    const match = message.match(pattern);
    if (match?.[1]) {
      result.name = match[1].trim();
      break;
    }
  }

  // Location extraction: structural patterns first, then known district/city lookup
  for (const [pattern, group] of LOCATION_PATTERNS) {
    const match = message.match(pattern);
    if (match?.[group]) {
      result.location = match[group].trim();
      break;
    }
  }
  if (!result.location) {
    const lower = message.toLowerCase();
    for (const [key, canonical] of Object.entries(KNOWN_LOCATIONS)) {
      if (lower.includes(key)) {
        result.location = canonical;
        break;
      }
    }
  }

  result.leadScore = calculateLeadScore(result);

  return result;
}

export function detectConflict(
  state: ConversationState,
  extracted: ExtractedSlots
): string | null {
  if (state.service && extracted.service && state.service !== extracted.service) {
    return `Daha önce ${state.service} hakkında konuşmuştuk. ${extracted.service} mi yoksa ${state.service} için mi randevu almak istiyorsunuz?`;
  }
  return null;
}

// Computes leadScore from the full accumulated conversation state (not just one message's slots).
// Call this after merging extractedSlots into state to get an accurate multi-turn score.
export function calculateLeadScoreFromState(state: {
  service?: string;
  preferredDate?: string;
  preferredTime?: string;
  name?: string;
  phone?: string;
  urgency?: UrgencyLevel;
}): LeadScore {
  const hasDateTime = !!(state.preferredDate || state.preferredTime);
  const hasService = !!state.service;
  const hasContact = !!(state.name || state.phone);
  const isUrgent = state.urgency === "high";

  if (isUrgent) return "hot";
  if (hasService && hasDateTime) return "hot";
  if (hasService && hasContact) return "hot";
  if (hasService || hasDateTime) return "warm";
  return "cold";
}
