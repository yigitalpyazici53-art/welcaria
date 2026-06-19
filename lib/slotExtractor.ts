import type { ConversationState, UrgencyLevel, LeadScore } from "./conversationState";

export interface ExtractedSlots {
  name?: string;
  phone?: string;
  service?: string;
  treatmentArea?: string;
  firstTimeLaser?: boolean;
  priceInquired?: boolean;
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

// Laser/aesthetic service patterns — most specific first.
const SERVICE_PATTERNS: Array<[RegExp, string]> = [
  [/lazer\s+epilasyon|epilasyon|lazer/i, "lazer epilasyon"],
  [/botoks?|dolgu|filler/i, "estetik uygulama"],
  [/cilt\s+bak|yüz\s+bak|facial/i, "cilt bakımı"],
  [/masaj|terapi/i, "masaj"],
];

// Body-area patterns for laser epilasyon — most specific first.
const TREATMENT_AREA_PATTERNS: Array<[RegExp, string]> = [
  [/tüm\s+vücut|full\s+body/i, "tüm vücut"],
  [/koltuk\s*alt[ıi]/i, "koltuk altı"],
  [/bikini/i, "bikini"],
  [/bıyık|dudak\s*üst[üu]|üst\s*dudak/i, "dudak üstü"],
  [/çene/i, "çene"],
  [/sırt/i, "sırt"],
  [/göğüs/i, "göğüs"],
  [/genital/i, "genital"],
  [/bacak/i, "bacak"],
  [/\bkol\b/i, "kol"],
  [/yüz/i, "yüz"],
];

// Returning-customer signals — checked before first-time to avoid false negatives.
const FIRST_TIME_FALSE_PATTERNS: RegExp[] = [
  /daha\s+önce\s+yaptırd[ıi][mn]/i,
  /devam\s+ediyorum/i,
  /seanslar[ıi]m\s+var/i,
  /seans[ıi]m\s+var/i,
  /yarım\s+kald[ıi]/i,
  /tekrar\s+başla/i,
  /seansa?\s+devam/i,
  /önceden\s+yaptırd[ıi][mn]/i,
];

// First-time signals.
// Use [İi] explicitly — JavaScript regex /i flag does not map 'i' ↔ 'İ' (Turkish dotted-I).
const FIRST_TIME_TRUE_PATTERNS: RegExp[] = [
  /[İi]lk\s+kez/,
  /[İi]lk\s+defa/,
  /daha\s+önce\s+yaptırma[dm][ıi][mn]?/i,
  /hiç\s+yaptırma[dm][ıi][mn]?/i,
  /başlama[dm][ıi][mn]?/i,
  /yaptırmadım/i,
  /hiç\s+denemedim/i,
];

// Price / package inquiry signals.
const PRICE_INQUIRY_PATTERNS: RegExp[] = [
  /fiyat/i,
  /ücret/i,
  /ne\s+kadar/i,
  /kaç\s+(tl|lira|para)/i,
  /kampanya/i,
  /paket/i,
  /indirim/i,
  /ödeme/i,
  /tutar/i,
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
const LOCATION_PATTERNS: Array<[RegExp, number]> = [
  [/(?:[ŞşSs]ube|[Kk]onum|[Ll]okasyon|[Aa]dres)\s*:\s*([A-ZÇĞİÖŞÜa-zçğışöü][A-Za-zÇĞİÖŞÜçğışöü]*)/, 1],
  [/[ŞşSs]ube\s+([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+)/, 1],
  [/([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+(?:\s+[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+)?)\s+şube/, 1],
  [/[Kk]onum\s+([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+)/, 1],
  [/[Şş]ube\s+olarak\s+([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+)/, 1],
  [/([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+)\s+(?:tarafı|yakın)/, 1],
  [/[Bb]ana\s+([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+)/, 1],
];

// Looks for explicit name introductions
const NAME_PATTERNS: RegExp[] = [
  /(?:[İi]sim|[Aa]d(?:ım)?)\s*:\s*([A-ZÇĞİÖŞÜa-zçğışöüI][A-Za-zÇĞİÖŞÜçğışöü]*)/,
  /\b(?:ben|benim adım|ismim|adım)\s+([A-ZÇĞİÖŞÜa-zçğışöüI]{2,}(?:\s+[A-ZÇĞİÖŞÜa-zçğışöüI]{2,})?)\b/i,
  /^([A-ZÇĞİÖŞÜ][a-zçğışöü]{1,}(?:\s+[A-ZÇĞİÖŞÜ][a-zçğışöü]{1,})?)\s+(?:olarak|aradım|yazıyorum|merhaba)\b/,
];

// Words that must not be mistaken for a Turkish name in the bare-word fallback
const NAME_BLOCKLIST = new Set([
  // services / treatments
  "lazer", "epilasyon", "masaj", "botoks", "dolgu", "wax", "ağda",
  "makyaj", "facial", "estetik", "seans", "paket", "kampanya", "indirim",
  // body areas
  "bacak", "kol", "sırt", "göğüs", "çene", "bikini", "genital", "bölge",
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
  const stripped = trimmed.replace(NAME_INTRO_RE, "").trim();
  const words = stripped.split(/\s+/).slice(0, 2);
  const candidate = words.join(" ");

  if (!BARE_NAME_RE.test(candidate)) return undefined;
  if (words.some((w) => NAME_BLOCKLIST.has(w.toLowerCase()))) return undefined;

  return words.map(turkishTitleCase).join(" ");
}

function calculateLeadScore(slots: ExtractedSlots): LeadScore {
  const hasService = !!(slots.service || slots.treatmentArea);
  const hasDateTime = !!(slots.preferredDate || slots.preferredTime);
  const isUrgent = slots.urgency === "high";

  if (isUrgent) return "hot";
  if (hasService && hasDateTime) return "hot";
  if (slots.priceInquired && hasService) return "warm";
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

  for (const [pattern, area] of TREATMENT_AREA_PATTERNS) {
    if (pattern.test(message)) {
      result.treatmentArea = area;
      break;
    }
  }

  // Check returning-customer signals before first-time signals to avoid false negatives.
  if (FIRST_TIME_FALSE_PATTERNS.some((p) => p.test(message))) {
    result.firstTimeLaser = false;
  } else if (FIRST_TIME_TRUE_PATTERNS.some((p) => p.test(message))) {
    result.firstTimeLaser = true;
  }

  if (PRICE_INQUIRY_PATTERNS.some((p) => p.test(message))) {
    result.priceInquired = true;
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
  if (state.treatmentArea && extracted.treatmentArea && state.treatmentArea !== extracted.treatmentArea) {
    return `Daha önce ${state.treatmentArea} bölgesinden bahsetmiştiniz. Hangi bölge için devam etmek istersiniz: ${extracted.treatmentArea} mi yoksa ${state.treatmentArea} mi?`;
  }
  if (state.service && extracted.service && state.service !== extracted.service) {
    return `Daha önce ${state.service} hakkında konuşmuştuk. ${extracted.service} mi yoksa ${state.service} için mi randevu almak istiyorsunuz?`;
  }
  return null;
}

// Computes leadScore from the full accumulated conversation state (not just one message's slots).
// Call this after merging extractedSlots into state to get an accurate multi-turn score.
export function calculateLeadScoreFromState(state: {
  service?: string;
  treatmentArea?: string;
  preferredDate?: string;
  preferredTime?: string;
  name?: string;
  phone?: string;
  urgency?: UrgencyLevel;
  priceInquired?: boolean;
  firstTimeLaser?: boolean;
}): LeadScore {
  const hasService = !!(state.service || state.treatmentArea);
  const hasDateTime = !!(state.preferredDate || state.preferredTime);
  const hasContact = !!(state.name || state.phone);
  const isUrgent = state.urgency === "high";

  if (isUrgent) return "hot";
  if (hasService && hasDateTime && hasContact) return "hot";
  if (hasService && hasDateTime) return "hot";
  if (state.priceInquired && hasService && hasDateTime) return "hot";
  if (state.priceInquired && hasService) return "warm";
  if (hasService) return "warm";
  if (hasDateTime) return "warm";
  return "cold";
}
