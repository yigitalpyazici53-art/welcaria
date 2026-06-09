export type IntentCategory =
  | "appointment_request"
  | "price_question"
  | "service_question"
  | "location_question"
  | "availability_question"
  | "human_handoff"
  | "complaint"
  | "urgent_request"
  | "irrelevant"
  | "other";

export interface IntentResult {
  notify: boolean;
  category: IntentCategory;
  urgency: "HIGH" | "MEDIUM" | "LOW";
  shortIssue: string;
}

const APPOINTMENT_KEYWORDS = [
  "randevu", "rezervasyon", "ayarla", "book", "appointment",
  "saat ayır", "gelmek istiyorum", "gelebilir miyim", "müsait",
];

const PRICE_KEYWORDS = [
  "fiyat", "ücret", "ne kadar", "kaç para", "tutar", "ödeme",
  "indirim", "kampanya", "fiyatı ne", "fee", "price", "cost",
];

const SERVICE_KEYWORDS = [
  "hizmet", "ne yapıyorsunuz", "neler var", "seçenekler", "işlemler",
  "uygulama", "tedavi", "servis", "service",
];

const LOCATION_KEYWORDS = [
  "adres", "nerede", "konum", "lokasyon", "neredesiniz", "yol tarifi",
  "nasıl gelirim", "address", "location", "where",
];

const AVAILABILITY_KEYWORDS = [
  "müsait misiniz", "uygun mu", "boş mu", "doldu mu", "hafta sonu",
  "bugün", "yarın", "available", "açık mı", "çalışıyor musunuz",
];

const HUMAN_HANDOFF_KEYWORDS = [
  "insanla konuşmak", "müşteri hizmetleri", "yetkili", "yönetici",
  "birileriyle konuş", "gerçek kişi", "agent", "human", "speak to",
];

const COMPLAINT_KEYWORDS = [
  "şikayet", "memnun değil", "kötü", "berbat", "sorun", "problem",
  "hata", "hayal kırıklığı", "complaint", "unhappy",
];

const URGENT_KEYWORDS = [
  "acil", "ivedi", "hemen", "şimdi", "urgent", "asap", "derhal",
  "bekleyemem", "bugün mutlaka",
];

export function classifyIntent(
  customerMessage: string,
  isFirstMessage: boolean
): IntentResult {
  const lower = customerMessage.toLowerCase();
  const shortIssue =
    customerMessage.length > 50
      ? customerMessage.slice(0, 47) + "..."
      : customerMessage;

  if (URGENT_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { notify: true, category: "urgent_request", urgency: "HIGH", shortIssue };
  }

  if (APPOINTMENT_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { notify: true, category: "appointment_request", urgency: "MEDIUM", shortIssue };
  }

  if (PRICE_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { notify: true, category: "price_question", urgency: "MEDIUM", shortIssue };
  }

  if (AVAILABILITY_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { notify: true, category: "availability_question", urgency: "MEDIUM", shortIssue };
  }

  if (SERVICE_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { notify: false, category: "service_question", urgency: "LOW", shortIssue };
  }

  if (LOCATION_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { notify: false, category: "location_question", urgency: "LOW", shortIssue };
  }

  if (HUMAN_HANDOFF_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { notify: true, category: "human_handoff", urgency: "MEDIUM", shortIssue };
  }

  if (COMPLAINT_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { notify: true, category: "complaint", urgency: "HIGH", shortIssue };
  }

  if (isFirstMessage) {
    return { notify: true, category: "other", urgency: "LOW", shortIssue };
  }

  return { notify: false, category: "other", urgency: "LOW", shortIssue };
}
