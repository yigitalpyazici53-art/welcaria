// Deterministic multilingual copy for the static (no-AI) reply path and for
// price/booking-link formatting. Covers the seven supported conversation languages.
// Clinic-configured values (prices, brands, addresses, URLs) are always inserted
// VERBATIM — only the surrounding sentence changes language. This is a small typed
// dictionary, not a translation framework.

export type SupportedLanguage =
  | "turkish"
  | "english"
  | "german"
  | "arabic"
  | "russian"
  | "french"
  | "spanish";

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  "turkish",
  "english",
  "german",
  "arabic",
  "russian",
  "french",
  "spanish",
];

// Maps a stored detectedLanguage to a supported language. English is the default ONLY
// when no conversation language was ever established (callers pass state.detectedLanguage,
// which stays sticky across language-neutral turns).
export function resolveLanguage(language?: string): SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(language ?? "")
    ? (language as SupportedLanguage)
    : "english";
}

// ── Treatment-area display labels ─────────────────────────────────────────────
// Slot extraction stores ONE canonical value per area (e.g. "full body", "koltuk altı").
// Those canonical values must never reach the patient reply or the owner alert raw in the
// wrong language ("full body" inside a Turkish sentence, "koltuk altı" inside a German one).
// This maps each canonical value to a localized display label. TR/EN/DE are the
// live-verified languages; other languages fall back to the English label. Any value not in
// the map — a service name ("lazer epilasyon") or free text — passes through UNCHANGED, so
// callers can pass `treatmentArea || service` safely.
const TREATMENT_AREA_LABELS: Record<string, Partial<Record<SupportedLanguage, string>>> = {
  "full body":   { turkish: "tüm vücut",   english: "full body", german: "Ganzkörper" },
  "koltuk altı": { turkish: "koltuk altı", english: "underarms", german: "Achseln" },
  "bikini":      { turkish: "bikini",      english: "bikini",    german: "Bikinizone" },
  "dudak üstü":  { turkish: "dudak üstü",  english: "upper lip", german: "Oberlippe" },
  "çene":        { turkish: "çene",        english: "chin",      german: "Kinn" },
  "sırt":        { turkish: "sırt",        english: "back",      german: "Rücken" },
  "göğüs":       { turkish: "göğüs",       english: "chest",     german: "Brust" },
  "genital":     { turkish: "genital",     english: "genital",   german: "Intimbereich" },
  "bacak":       { turkish: "bacak",       english: "legs",      german: "Beine" },
  "kol":         { turkish: "kol",         english: "arms",      german: "Arme" },
  "yüz":         { turkish: "yüz",         english: "face",      german: "Gesicht" },
};

// Localizes a canonical treatment-area value for outbound text. The SINGLE helper used by
// both the patient completion reply and the owner alert — do not localize areas anywhere
// else. Unknown values (service names, free text) are returned verbatim.
export function treatmentAreaLabel(area?: string, language?: string): string {
  if (!area) return "";
  const entry = TREATMENT_AREA_LABELS[area.trim().toLowerCase()];
  if (!entry) return area;
  const lang = resolveLanguage(language);
  return entry[lang] ?? entry.english ?? area;
}

// ── Turkish ablative suffix ("2.500 TL" → "2.500 TL'den") ────────────────────
// Turkish vowel harmony + final-consonant hardening decide between den/dan/ten/tan.
// The suffix is chosen from the PRONUNCIATION of the trailing token, so the configured
// price is never blindly concatenated ("2.500den").

type AblativeSuffix = "'den" | "'dan" | "'ten" | "'tan";

// Pronunciation of the final counting word for numbers ending in zeros:
// on(10)→dan, yirmi→den, otuz→dan, kırk→tan, elli→den, altmış→tan, yetmiş→ten,
// seksen→den, doksan→dan; yüz→den, bin→den, milyon→dan.
const TENS_SUFFIX: Record<string, AblativeSuffix> = {
  "10": "'dan", "20": "'den", "30": "'dan", "40": "'tan", "50": "'den",
  "60": "'tan", "70": "'ten", "80": "'den", "90": "'dan",
};

// Pronunciation of the final digit: bir→den, iki→den, üç→ten, dört→ten, beş→ten,
// altı→dan, yedi→den, sekiz→den, dokuz→dan, sıfır→dan.
const DIGIT_SUFFIX: Record<string, AblativeSuffix> = {
  "0": "'dan", "1": "'den", "2": "'den", "3": "'ten", "4": "'ten",
  "5": "'ten", "6": "'dan", "7": "'den", "8": "'den", "9": "'dan",
};

export function turkishAblativeSuffix(rawValue: string): AblativeSuffix {
  const value = rawValue.trim();

  // Currency tokens — suffix follows the spoken form ("te-le", "lira", "euro", "dolar").
  if (/(?:tl|₺)$/i.test(value)) return "'den";
  if (/lira(?:sı)?$/i.test(value)) return "'dan";
  if (/(?:eur|euro|€)$/i.test(value)) return "'dan";
  if (/(?:usd|dolar|\$)$/i.test(value)) return "'dan";

  // Trailing number — use the final spoken counting word.
  const numMatch = value.match(/([\d.,\s]*\d)$/);
  if (numMatch) {
    const digits = numMatch[1].replace(/\D/g, "");
    if (/000000$/.test(digits)) return "'dan"; // milyon
    if (/000$/.test(digits)) return "'den";    // bin
    if (/00$/.test(digits)) return "'den";     // yüz
    if (/0$/.test(digits)) return TENS_SUFFIX[digits.slice(-2)] ?? "'dan";
    return DIGIT_SUFFIX[digits.slice(-1)] ?? "'den";
  }

  // Generic word: last vowel decides front/back, final consonant decides soft/hard.
  const lower = value.toLowerCase();
  const vowels = lower.match(/[aeıioöuü]/g);
  const lastVowel = vowels ? vowels[vowels.length - 1] : "e";
  const isBack = "aıou".includes(lastVowel);
  const isHardFinal = "fstkçşhp".includes(lower.slice(-1));
  if (isHardFinal) return isBack ? "'tan" : "'ten";
  return isBack ? "'dan" : "'den";
}

// "2.500 TL" → "2.500 TL'den"
export function turkishAblative(value: string): string {
  return `${value.trim()}${turkishAblativeSuffix(value)}`;
}

// ── Starting-price sentence ──────────────────────────────────────────────────
// Configured price is quoted verbatim inside a natural sentence in the reply language.
// If the configured value already contains "starting/başlangıç"-style wording, a neutral
// template is used instead so the reply never doubles up
// ("demo başlangıç fiyatından başlamaktadır").

const PRICE_ALREADY_WORDED_RE =
  /başlangıç|başlam|başlar|start|from\s|desde|partir|preis(?:e)?\s*ab|من\s|от\s/i;

export function formatStartingPriceSentence(price: string, language?: string): string {
  const lang = resolveLanguage(language);
  const p = price.trim();

  if (PRICE_ALREADY_WORDED_RE.test(p)) {
    switch (lang) {
      case "turkish": return `Fiyat bilgisi: ${p}. Net fiyat tedavi planına göre belirlenir.`;
      case "german":  return `Preisinformation: ${p}. Der Endpreis hängt vom Behandlungsplan ab.`;
      case "arabic":  return `معلومات السعر: ${p}. يعتمد السعر النهائي على خطة العلاج.`;
      case "russian": return `Информация о цене: ${p}. Итоговая стоимость зависит от плана лечения.`;
      case "french":  return `Information tarifaire : ${p}. Le prix final dépend du plan de traitement.`;
      case "spanish": return `Información de precio: ${p}. El precio final depende del plan.`;
      default:        return `Pricing guidance: ${p}. The final price depends on the treatment plan.`;
    }
  }

  switch (lang) {
    case "turkish": return `Fiyatlarımız ${turkishAblative(p)} başlamaktadır; net fiyat plana bağlıdır.`;
    case "german":  return `Die Preise beginnen bei ${p}; der Endpreis hängt vom Behandlungsplan ab.`;
    case "arabic":  return `تبدأ الأسعار من ${p}؛ ويعتمد السعر النهائي على خطة العلاج.`;
    case "russian": return `Цены начинаются от ${p}; итоговая стоимость зависит от плана лечения.`;
    case "french":  return `Les tarifs commencent à ${p} ; le prix final dépend du plan de traitement.`;
    case "spanish": return `Los precios empiezan en ${p}; el precio final depende del plan.`;
    default:        return `Pricing starts from ${p}; final cost depends on the plan.`;
  }
}

// ── Exact configured-price enforcement ────────────────────────────────────────
// The configured starting price is an OPAQUE LITERAL: it must appear byte-for-byte in
// every reply, in every language. AI replies sometimes localize digit grouping
// ("₺2.500" → "₺2,500") or swap the currency token ("₺2.500" → "2.500 TL" / "TRY 2,500").
// This deterministically rewrites any such variant back to the exact configured string.

const CURRENCY_FAMILIES: string[][] = [
  ["₺", "TL", "TRY", "lira"],
  ["€", "EUR", "euro"],
  ["$", "USD", "dollar"],
  ["£", "GBP", "pound"],
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Alphabetic tokens need word boundaries ("TL" must not match inside a word); currency
// symbols are non-word chars where \b misbehaves, so they are matched bare.
function currencyTokenPattern(token: string): string {
  return /^[a-z]+$/i.test(token) ? `\\b${token}\\b` : escapeRe(token);
}

export function enforceExactPriceLiteral(reply: string, configuredPrice: string): string {
  const p = configuredPrice.trim();
  if (!p) return reply;
  // Reply already carries the exact literal — leave it untouched.
  if (reply.includes(p)) return reply;

  const numMatch = p.match(/\d[\d.,\s]*\d|\d/);
  if (!numMatch) return reply;
  const digits = numMatch[0].replace(/\D/g, "");
  if (!digits) return reply;

  const family = CURRENCY_FAMILIES.find((f) =>
    f.some((tok) => p.toLowerCase().includes(tok.toLowerCase()))
  );
  if (!family) return reply;

  // Same digit sequence with ANY grouping separators (2.500 / 2,500 / 2 500 / 2500),
  // guarded so it never matches inside a longer number ("2.500" in "2.500.000").
  const flexibleNumber = digits.split("").join("[.,\\s]?");
  const cur = family.map(currencyTokenPattern).join("|");
  const variant = new RegExp(
    `(?<![\\d.,])(?:(?:${cur})\\s*${flexibleNumber}|${flexibleNumber}\\s*(?:${cur}))(?!\\d)(?![.,]\\d)`,
    "gi"
  );
  return reply.replace(variant, p);
}

// ── Static fallback dictionary ────────────────────────────────────────────────
// Every mid-flow fallback the pipeline can emit when Anthropic is unavailable.
// Strings are kept short so composed replies survive the SMS length cap.

export type FallbackKind =
  | "safePrice"
  | "firstTimeQuestion"
  | "firstTimeLaserQuestion"
  | "graftQuestion"
  | "travelQuestion"
  | "dentalScopeQuestion"
  | "qualificationClarify"
  | "treatmentAreaQuestion"
  | "dateTimeQuestion"
  | "namePhoneQuestion"
  | "availabilityAck"
  | "locationFallback"
  | "deviceFallback"
  | "preTreatmentFallback"
  | "transferFallback"
  | "instagramRedirect"
  | "postCompletionAck";

const FALLBACKS: Record<FallbackKind, Record<SupportedLanguage, string>> = {
  safePrice: {
    turkish: "Fiyat bilgisi tedavi planına göre değişebilir; ekibimiz net bilgi paylaşacaktır.",
    english: "Pricing depends on the treatment plan; our team will share exact details.",
    german:  "Der Preis hängt vom Behandlungsplan ab; unser Team teilt Ihnen die Details mit.",
    arabic:  "تعتمد الأسعار على خطة العلاج؛ وسيشارككم فريقنا التفاصيل الدقيقة.",
    russian: "Стоимость зависит от плана лечения; наша команда сообщит точные детали.",
    french:  "Le prix dépend du plan de traitement ; notre équipe vous donnera les détails.",
    spanish: "El precio depende del plan de tratamiento; nuestro equipo le dará los detalles.",
  },
  firstTimeQuestion: {
    turkish: "Bu işlemi ilk kez mi yaptırıyorsunuz?",
    english: "Is this your first time having this treatment?",
    german:  "Ist dies Ihre erste Behandlung dieser Art?",
    arabic:  "هل هذه أول مرة تجري فيها هذا الإجراء؟",
    russian: "Вы впервые проходите эту процедуру?",
    french:  "Est-ce la première fois que vous faites ce soin ?",
    spanish: "¿Sería esta su primera sesión de este tratamiento?",
  },
  // Laser-specific first-time question — the preferred natural wording when the service
  // is known to be laser. Formal register (Sie/vous/su); Arabic uses the gender-neutral
  // form ("تجري" instead of the feminine "تخضعين").
  firstTimeLaserQuestion: {
    turkish: "Bu işlemi ilk kez mi yaptırıyorsunuz?",
    english: "Would this be your first laser treatment?",
    german:  "Ist dies Ihre erste Laserbehandlung?",
    arabic:  "هل هذه أول مرة تجري فيها إزالة الشعر بالليزر؟",
    russian: "Вы впервые планируете лазерную эпиляцию?",
    french:  "S'agit-il de votre première épilation laser ?",
    spanish: "¿Sería esta su primera sesión de depilación láser?",
  },
  graftQuestion: {
    turkish: "Yaklaşık kaç greft düşündüğünüzü biliyor musunuz?",
    english: "Do you know roughly how many grafts you are considering?",
    german:  "Wissen Sie ungefähr, wie viele Grafts Sie benötigen?",
    arabic:  "هل تعرفون تقريبًا عدد البصيلات المطلوبة؟",
    russian: "Знаете ли вы примерное количество графтов?",
    french:  "Savez-vous environ combien de greffons vous envisagez ?",
    spanish: "¿Sabe aproximadamente cuántos injertos está considerando?",
  },
  travelQuestion: {
    turkish: "Yurt dışından mı geliyorsunuz, yoksa İstanbul'da mı bulunuyorsunuz?",
    english: "Will you be travelling to Istanbul, or are you already based here?",
    german:  "Reisen Sie aus dem Ausland an oder sind Sie bereits in Istanbul?",
    arabic:  "هل ستسافرون إلى إسطنبول أم أنتم موجودون فيها بالفعل؟",
    russian: "Вы приедете в Стамбул или уже находитесь здесь?",
    french:  "Venez-vous de l'étranger ou êtes-vous déjà à Istanbul ?",
    spanish: "¿Viajará a Estambul o ya se encuentra aquí?",
  },
  dentalScopeQuestion: {
    turkish: "Full smile design mı yoksa belirli sayıda diş mi düşünüyorsunuz?",
    english: "Are you considering a full smile design or a few teeth?",
    german:  "Denken Sie an ein komplettes Smile Design oder an einzelne Zähne?",
    arabic:  "هل تفكرون في تصميم ابتسامة كامل أم في عدد محدد من الأسنان؟",
    russian: "Вы рассматриваете полный дизайн улыбки или несколько зубов?",
    french:  "Envisagez-vous un smile design complet ou quelques dents ?",
    spanish: "¿Considera un diseño de sonrisa completo o solo algunos dientes?",
  },
  qualificationClarify: {
    turkish: "Size daha iyi yardımcı olabilmemiz için ne aradığınızı biraz açar mısınız?",
    english: "To guide you better, could you share a bit more about what you are looking for?",
    german:  "Um Sie besser zu beraten: Können Sie kurz beschreiben, was Sie suchen?",
    arabic:  "لنساعدكم بشكل أفضل، هل يمكنكم مشاركة المزيد عما تبحثون عنه؟",
    russian: "Чтобы лучше вам помочь, расскажите, пожалуйста, что именно вас интересует.",
    french:  "Pour mieux vous guider, pouvez-vous préciser ce que vous recherchez ?",
    spanish: "Para orientarle mejor, ¿podría contarnos un poco más sobre lo que busca?",
  },
  treatmentAreaQuestion: {
    turkish: "Merhaba! Hangi bölge veya işlemle ilgileniyorsunuz?",
    english: "Hi! Which area or treatment are you interested in?",
    german:  "Hallo! Für welche Behandlung oder Zone interessieren Sie sich?",
    arabic:  "مرحبًا! ما المنطقة أو العلاج الذي يهمكم؟",
    russian: "Здравствуйте! Какая зона или процедура вас интересует?",
    french:  "Bonjour ! Quelle zone ou quel soin vous intéresse ?",
    spanish: "¡Hola! ¿Qué zona o tratamiento le interesa?",
  },
  dateTimeQuestion: {
    turkish: "Hangi gün ve saat sizin için uygun olur?",
    english: "Which day and time would work best for you?",
    german:  "Welcher Tag und welche Uhrzeit würden Ihnen passen?",
    arabic:  "ما اليوم والوقت الأنسب لكم؟",
    russian: "Какой день и время вам подходят?",
    french:  "Quel jour et quelle heure vous conviendraient ?",
    spanish: "¿Qué día y hora le vendrían mejor?",
  },
  namePhoneQuestion: {
    turkish: "İsminizi ve telefon numaranızı alabilir miyim?",
    english: "Could I please take your name and phone number?",
    german:  "Dürfte ich Ihren Namen und Ihre Telefonnummer notieren?",
    arabic:  "هل يمكنني الحصول على اسمكم ورقم هاتفكم؟",
    russian: "Могу я узнать ваше имя и номер телефона?",
    french:  "Puis-je avoir votre nom et votre numéro de téléphone ?",
    spanish: "¿Podría indicarme su nombre y número de teléfono?",
  },
  availabilityAck: {
    turkish: "Talebinizi not aldık; ekibimiz uygunluğu kontrol edip size dönüş yapacaktır.",
    english: "Noted your preferred time; our team will check availability.",
    german:  "Wir haben Ihren Terminwunsch notiert; unser Team prüft die Verfügbarkeit.",
    arabic:  "سجلنا الموعد المفضل لديكم؛ وسيتحقق فريقنا من التوفر.",
    russian: "Мы записали удобное вам время; команда проверит доступность.",
    french:  "Nous avons noté votre créneau ; notre équipe vérifiera la disponibilité.",
    spanish: "Hemos anotado su horario; nuestro equipo confirmará la disponibilidad.",
  },
  locationFallback: {
    turkish: "Ekibimiz adres ve yol tarifini sizinle paylaşacaktır.",
    english: "Our team will share the clinic address and directions when they follow up.",
    german:  "Unser Team teilt Ihnen Adresse und Wegbeschreibung mit.",
    arabic:  "سيشارككم فريقنا عنوان العيادة وكيفية الوصول إليها.",
    russian: "Наша команда сообщит вам адрес клиники и как добраться.",
    french:  "Notre équipe vous communiquera l'adresse et l'itinéraire.",
    spanish: "Nuestro equipo le compartirá la dirección y cómo llegar.",
  },
  deviceFallback: {
    turkish: "Cihaz ve teknoloji bilgisini ekibimiz sizinle paylaşacaktır.",
    english: "Our team will share details about the devices and technology we use.",
    german:  "Unser Team informiert Sie über die eingesetzten Geräte und Technologien.",
    arabic:  "سيشارككم فريقنا تفاصيل الأجهزة والتقنيات المستخدمة.",
    russian: "Наша команда расскажет об используемых аппаратах и технологиях.",
    french:  "Notre équipe vous renseignera sur les appareils et technologies utilisés.",
    spanish: "Nuestro equipo le informará sobre los equipos y tecnologías utilizados.",
  },
  preTreatmentFallback: {
    turkish: "Kesin hazırlık adımlarını ekibimiz ziyaretinizden önce sizinle paylaşacaktır.",
    english: "Our team will share the exact preparation steps before your visit.",
    german:  "Die genauen Vorbereitungsschritte teilt Ihnen unser Team vor Ihrem Besuch mit.",
    arabic:  "سيشارككم فريقنا خطوات التحضير الدقيقة قبل زيارتكم.",
    russian: "Точные шаги подготовки наша команда сообщит вам перед визитом.",
    french:  "Notre équipe vous communiquera les étapes exactes de préparation avant votre visite.",
    spanish: "Nuestro equipo le indicará los pasos exactos de preparación antes de su visita.",
  },
  transferFallback: {
    turkish: "Havalimanı transferi bilgisini ekibimiz sizinle paylaşacaktır.",
    english: "Our team will share airport transfer details when they follow up.",
    german:  "Unser Team informiert Sie über den Flughafentransfer.",
    arabic:  "سيشارككم فريقنا تفاصيل خدمة النقل من المطار.",
    russian: "Наша команда сообщит детали трансфера из аэропорта.",
    french:  "Notre équipe vous donnera les détails du transfert aéroport.",
    spanish: "Nuestro equipo le dará los detalles del traslado desde el aeropuerto.",
  },
  instagramRedirect: {
    turkish: "En hızlı yanıt için bize buradan, WhatsApp üzerinden ulaşabilirsiniz. Ekibimiz yardımcı olmaktan memnuniyet duyar.",
    english: "For the fastest response, you can reach us right here on WhatsApp. Our team will be happy to help.",
    german:  "Am schnellsten erreichen Sie uns direkt hier über WhatsApp. Unser Team hilft Ihnen gerne.",
    arabic:  "للحصول على أسرع رد، يمكنكم التواصل معنا هنا عبر واتساب. يسعد فريقنا بمساعدتكم.",
    russian: "Для самого быстрого ответа пишите нам прямо здесь, в WhatsApp. Наша команда будет рада помочь.",
    french:  "Pour une réponse rapide, contactez-nous directement ici sur WhatsApp. Notre équipe se fera un plaisir de vous aider.",
    spanish: "Para una respuesta más rápida, contáctenos aquí por WhatsApp. Nuestro equipo estará encantado de ayudarle.",
  },
  postCompletionAck: {
    turkish: "Talebiniz bizde. Ekibimiz kısa süre içinde sizinle iletişime geçecektir.",
    english: "Your request is with our team. They will follow up with you shortly.",
    german:  "Ihre Anfrage liegt unserem Team vor. Wir melden uns in Kürze bei Ihnen.",
    arabic:  "طلبكم لدى فريقنا وسيتواصل معكم قريبًا.",
    russian: "Ваша заявка у нашей команды. Мы скоро с вами свяжемся.",
    french:  "Votre demande est bien enregistrée. Notre équipe vous recontactera rapidement.",
    spanish: "Su solicitud está con nuestro equipo. Le contactaremos en breve.",
  },
};

export function fallbackText(kind: FallbackKind, language?: string): string {
  return FALLBACKS[kind][resolveLanguage(language)];
}

// Laser-family service names across the supported languages (canonical service strings
// plus raw patient phrasing). Used to pick the specific laser wording over the generic
// "this treatment" question — never generic when a laser phrase is known.
const LASER_SERVICE_NAME_RE =
  /laser|lazer|epilasyon|[ée]pilation|depilaci[oó]n|haarentfernung|лазер|эпиляц|ليزر/i;

// First-time qualification question in the preferred natural wording: laser-specific
// when the known service is laser-family, generic otherwise.
export function firstTimeQuestionText(language?: string, service?: string): string {
  const laserKnown = !!service && LASER_SERVICE_NAME_RE.test(service);
  return fallbackText(laserKnown ? "firstTimeLaserQuestion" : "firstTimeQuestion", language);
}

// ── Completion reply ──────────────────────────────────────────────────────────
// Turkish and English wording is byte-identical to the previous hardcoded replies so
// existing conversations and tests keep the exact same copy.

export function completionReply(language?: string, name?: string, area?: string): string {
  const lang = resolveLanguage(language);
  switch (lang) {
    case "turkish": {
      const thanks = name ? `Teşekkür ederiz ${name}.` : "Teşekkür ederiz.";
      const received = area ? `${area} için randevu talebinizi aldık.` : "Randevu talebinizi aldık.";
      return `${thanks} ${received} Ekibimiz kısa süre içinde sizinle iletişime geçecektir.`;
    }
    case "german":
      return `Vielen Dank${name ? ` ${name}` : ""}. Wir haben Ihre Terminanfrage${area ? ` für ${area}` : ""} erhalten. Unser Team meldet sich in Kürze bei Ihnen.`;
    case "arabic":
      return `شكرًا لكم${name ? ` ${name}` : ""}. استلمنا طلب موعدكم${area ? ` بخصوص ${area}` : ""}. سيتواصل معكم فريقنا قريبًا.`;
    case "russian":
      return `Спасибо${name ? `, ${name}` : ""}. Мы получили вашу заявку на приём${area ? ` (${area})` : ""}. Наша команда скоро свяжется с вами.`;
    case "french":
      return `Merci${name ? ` ${name}` : ""}. Nous avons bien reçu votre demande de rendez-vous${area ? ` pour ${area}` : ""}. Notre équipe vous contactera très prochainement.`;
    case "spanish":
      return `Gracias${name ? `, ${name}` : ""}. Hemos recibido su solicitud de cita${area ? ` para ${area}` : ""}. Nuestro equipo se pondrá en contacto con usted en breve.`;
    default: {
      const thanks = name ? `Thank you, ${name}.` : "Thank you.";
      const received = area
        ? `We received your appointment request for ${area}.`
        : "We received your appointment request.";
      return `${thanks} ${received} Our team will follow up shortly.`;
    }
  }
}

// Post-completion explicit name correction ("Adım Zeynep değil, Ayşe"): confirm the
// update without repeating the full completion message.
export function nameUpdatedReply(name: string, language?: string): string {
  switch (resolveLanguage(language)) {
    case "turkish": return `Teşekkürler, isminizi ${name} olarak güncelledik. Ekibimiz kısa süre içinde sizinle iletişime geçecektir.`;
    case "german":  return `Danke, ${name} — wir haben Ihren Namen aktualisiert. Unser Team meldet sich in Kürze.`;
    case "arabic":  return `شكرًا ${name}، قمنا بتحديث الاسم. سيتواصل معكم فريقنا قريبًا.`;
    case "russian": return `Спасибо, ${name} — мы обновили имя. Наша команда скоро свяжется с вами.`;
    case "french":  return `Merci ${name}, nous avons mis à jour votre nom. Notre équipe vous recontactera rapidement.`;
    case "spanish": return `Gracias, ${name}; hemos actualizado su nombre. Nuestro equipo le contactará en breve.`;
    default:        return `Thank you, ${name} — we have updated your name. Our team will follow up shortly.`;
  }
}

// ── Booking link message ──────────────────────────────────────────────────────
// Used for non-Turkish/non-English conversations; TR/EN keep the configurable env
// templates in clinicConfig for backward compatibility.

export function bookingLinkText(url: string, language?: string): string {
  switch (resolveLanguage(language)) {
    case "turkish": return `Randevu talebinizi buradan tamamlayabilirsiniz: ${url}`;
    case "german":  return `Hier können Sie Ihre Terminanfrage abschließen: ${url}`;
    case "arabic":  return `يمكنكم إكمال طلب الموعد من هنا: ${url}`;
    case "russian": return `Завершить заявку на приём можно здесь: ${url}`;
    case "french":  return `Vous pouvez finaliser votre demande de rendez-vous ici : ${url}`;
    case "spanish": return `Puede completar su solicitud de cita aquí: ${url}`;
    default:        return `You can complete your appointment request here: ${url}`;
  }
}

// ── Configured-value replies (value stays verbatim) ──────────────────────────

export function deviceBrandsReply(brands: string, language?: string): string {
  switch (resolveLanguage(language)) {
    case "turkish": return `Kliniğimizde ${brands} kullanılmaktadır.`;
    case "german":  return `Unsere Klinik verwendet ${brands}.`;
    case "arabic":  return `تستخدم عيادتنا ${brands}.`;
    case "russian": return `Наша клиника использует ${brands}.`;
    case "french":  return `Notre clinique utilise ${brands}.`;
    case "spanish": return `Nuestra clínica utiliza ${brands}.`;
    default:        return `Our clinic uses ${brands}.`;
  }
}

const ADDRESS_INTRO: Record<SupportedLanguage, string> = {
  turkish: "Adresimiz: {address}.",
  english: "Our address: {address}.",
  german:  "Unsere Adresse: {address}.",
  arabic:  "عنواننا: {address}.",
  russian: "Наш адрес: {address}.",
  french:  "Notre adresse : {address}.",
  spanish: "Nuestra dirección: {address}.",
};

const TRANSPORT_INTRO: Record<SupportedLanguage, string> = {
  turkish: "En yakın ulaşım: {value}.",
  english: "Nearest transport: {value}.",
  german:  "Nächste Verkehrsanbindung: {value}.",
  arabic:  "أقرب مواصلات: {value}.",
  russian: "Ближайший транспорт: {value}.",
  french:  "Transport le plus proche : {value}.",
  spanish: "Transporte más cercano: {value}.",
};

export interface LocationReplyInfo {
  address?: string;
  googleMapsLink?: string;
  nearestTransport?: string;
}

// Plain-text, WhatsApp-safe location reply: no Markdown links, "Google Maps: <url>" form.
export function locationReply(info: LocationReplyInfo, language?: string): string {
  const lang = resolveLanguage(language);
  const parts: string[] = [];
  if (info.address) parts.push(ADDRESS_INTRO[lang].replace("{address}", info.address));
  if (info.googleMapsLink) parts.push(`Google Maps: ${info.googleMapsLink}`);
  if (info.nearestTransport) parts.push(TRANSPORT_INTRO[lang].replace("{value}", info.nearestTransport));
  if (parts.length === 0) return fallbackText("locationFallback", lang);
  return parts.join(" ");
}

// Pre-treatment reply: configured clinic-approved note verbatim (already natural
// sentences), followed by the "team will confirm exact steps" closer. No medical advice
// is generated here — only configured text plus the fixed closer.
export function preTreatmentReply(configuredNote: string | undefined, language?: string): string {
  const lang = resolveLanguage(language);
  const closer = fallbackText("preTreatmentFallback", lang);
  if (!configuredNote) return closer;
  const note = configuredNote.trim();
  const sep = /[.!?؟]$/.test(note) ? " " : ". ";
  return `${note}${sep}${closer}`;
}

// Airport-transfer reply: configured note verbatim, else the localized fallback.
export function transferReply(configuredNote: string | undefined, language?: string): string {
  if (configuredNote && configuredNote.trim()) return configuredNote.trim();
  return fallbackText("transferFallback", resolveLanguage(language));
}
