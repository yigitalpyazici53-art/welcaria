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
  /\b\d{1,2}:\d{2}\b/,
  /\b(?:saat\s*)?\d{1,2}(?:[.,]\d{2})?\s*(?:de|da|'de|'da|te|ta)?\b/i,
  // No \b around Turkish chars (ö, ğ not in \w): reorder longer before shorter to avoid partial match
  /(sabah erken|öğleden sonra|öğle|akşam üstü|akşam|gece yarısı|gece)/i,
  /(sabah|öğleden sonra|öğle|akşam)/i,
];

const URGENCY_PATTERNS: Array<[RegExp, UrgencyLevel]> = [
  [/\b(acil|ivedi|acele|hemen|şimdi|derhal|bugün mutlaka|bekleyemem)\b/i, "high"],
  [/\b(bu hafta|yakında|kısa sürede|en kısa sürede|mümkün olan en kısa)\b/i, "medium"],
  [/\b(acele değil|acele yok|uygun olduğunda|ne zaman uygunsa|fırsat buldukça)\b/i, "low"],
];

// Common Turkish service business offerings
const SERVICE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(saç kesim|saç boyama|saç bakım|saç şekillendirme|hairstyle|haircut)\b/i, "saç bakımı"],
  [/\b(manikür|manicure|oje|tırnak)\b/i, "manikür"],
  [/\b(pedikür|pedicure)\b/i, "pedikür"],
  [/\b(kalıcı oje|kalıcı manikür|gel manikür)\b/i, "kalıcı manikür"],
  [/\b(kirpik lifting|kirpik lamine|kirpik boya|lash lift|lash)\b/i, "kirpik bakımı"],
  [/\b(kaş tasarım|kaş aldırma|kaş laminasyon|brow|kaş)\b/i, "kaş tasarımı"],
  [/\b(cilt bakım|yüz bakım|yüz maskesi|facial)\b/i, "cilt bakımı"],
  [/\b(botox|botoks|dolgu|filler|lip filler|dudak dolgu)\b/i, "estetik uygulama"],
  [/\b(lazer epilasyon|epilasyon|lazer)\b/i, "lazer epilasyon"],
  [/\b(masaj|massage|terapi)\b/i, "masaj"],
  // "diş" ends in ş (non-\w) so trailing \b fails — use (?!\w) lookahead instead
  [/\b(diş\s+(?:beyazlatma|kaplama)|veneer|zirkonyum|implant|\bdiş(?!\w))/i, "diş tedavisi"],
  [/\b(oto detay|araç yıkama|araç detay|araç bakım|car detail|car wash)\b/i, "oto detay"],
  [/\b(sakal|tıraş|erkek bakım|barber)\b/i, "erkek bakımı"],
  [/\b(wax|ağda)\b/i, "ağda"],
];

// Looks for explicit name introductions
const NAME_PATTERNS: RegExp[] = [
  /\b(?:ben|benim adım|ismim|adım)\s+([A-ZÇĞİÖŞÜa-zçğışöüI]{2,}(?:\s+[A-ZÇĞİÖŞÜa-zçğışöüI]{2,})?)\b/i,
  /^([A-ZÇĞİÖŞÜ][a-zçğışöü]{1,}(?:\s+[A-ZÇĞİÖŞÜ][a-zçğışöü]{1,})?)\s+(?:olarak|aradım|yazıyorum|merhaba)\b/,
];

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
