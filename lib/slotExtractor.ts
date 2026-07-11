import type { ConversationState, UrgencyLevel, LeadScore, ServiceCategory } from "./conversationState";

export type MessageLanguage = "turkish" | "english" | "arabic" | "german" | "russian" | "french" | "spanish";

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
  // Qualification fields
  serviceCategory?: ServiceCategory;
  travellingFromAbroad?: boolean;
  estimatedGrafts?: number;
  dentalTreatmentType?: string;
  teethCountOrScope?: string;
  treatmentTimeline?: string;
  // Premium clinic capability signals
  availabilityInquiry?: boolean;
  deviceInquiry?: boolean;
  preTreatmentInquiry?: boolean;
  detectedLanguage?: string;
}

// Turkish mobile: 05xx or +905xx. International fallback: +CC … (non-Turkish).
const PHONE_PATTERN =
  /(?:\+90|0)[\s\-]?(?:5\d{2})[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}|\+(?!90)\d[\d\s\-]{6,13}\d/;

// Turkish day and date patterns — order matters: specific before generic
const DATE_PATTERNS: RegExp[] = [
  /\b\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?\b/,
  /\b\d{1,2}\s+(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\b/i,
  /\b(bugün|bu gün|yarın|öbür gün|öbürgün)\b/i,
  /\b(pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)\b/i,
  /\bbu hafta\b/i,
  // English
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(today|tomorrow)\b/i,
];

const TIME_PATTERNS: RegExp[] = [
  /\b\d{1,2}:\d{2}\b/,                          // 14:00, 9:00
  /\bsaat\s*\d{1,2}(?:[.,]\d{2})?\b/i,         // saat 3, saat 15, saat 15.30
  // No \b around Turkish chars (ö, ğ not in \w): reorder longer before shorter to avoid partial match
  /(sabah erken|öğleden sonra|öğle|akşam üstü|akşam|gece yarısı|gece)/i,
  /(sabah|öğleden sonra|öğle|akşam)/i,
  // English — longer phrases first
  /\b(early morning|late afternoon|afternoon|morning|evening|night)\b/i,
];

const URGENCY_PATTERNS: Array<[RegExp, UrgencyLevel]> = [
  [/\b(acil|ivedi|acele|hemen|şimdi|derhal|bugün mutlaka|bekleyemem)\b/i, "high"],
  [/\b(bu hafta|yakında|kısa sürede|en kısa sürede|mümkün olan en kısa)\b/i, "medium"],
  [/\b(acele değil|acele yok|uygun olduğunda|ne zaman uygunsa|fırsat buldukça)\b/i, "low"],
];

// Service patterns — most specific first. Hair transplant and dental before laser to avoid
// false positives (e.g. "implant" must win over the generic "diş" fallback in dental).
const SERVICE_PATTERNS: Array<[RegExp, string]> = [
  // Hair transplant
  [/hair\s*transplant/i, "hair transplant"],
  [/saç\s*ekimi|sac\s*ekimi/i, "saç ekimi"],
  [/\b(fue|fut)\b/i, "hair transplant"],
  [/\bgrefts?\b|\bgreftler\b|\bgrafts?\b|\bgrft\b/i, "saç ekimi"],
  // Dental — specific types first
  [/smile\s*design|gülüş\s*(?:tasarım|dizayn)/i, "smile design"],
  [/dental\s*implant|diş\s*implant/i, "implant"],
  [/\bimplant\b/i, "implant"],
  [/veneer|diş\s*kaplama?|porselen\s*diş/i, "veneer"],
  [/diş\s*beyazlatma|teeth?\s*whiten|bleaching/i, "whitening"],
  [/\bdiş\b|\bdental\b/i, "dental"],
  // English laser (most specific first) — [aá] also catches Spanish "láser"
  [/laser\s+hair\s+removal/i, "laser hair removal"],
  // German compounds ("Ganzkörper-Laserbehandlung", "Laserepilation", "Haarentfernung")
  // are single words, so \blaser\b never fires — match the compound forms explicitly.
  [/laser[\s\-]*(?:behandlung|epilation|haarentfernung)|haarentfernung/i, "laser hair removal"],
  [/\bl[aá]ser\b/i, "laser hair removal"],
  // French/Spanish laser hair removal terms
  [/[eé]pilation|depilaci[oó]n/i, "laser hair removal"],
  // Russian / Arabic laser terms (Cyrillic and Arabic are outside JS \w — no \b)
  [/лазер|эпиляц/i, "laser hair removal"],
  [/ليزر/, "laser hair removal"],
  // Turkish laser
  [/lazer\s+epilasyon|epilasyon|lazer/i, "lazer epilasyon"],
  // Other aesthetic
  [/botoks?|dolgu|filler/i, "estetik uygulama"],
  [/cilt\s+bak|yüz\s+bak|facial/i, "cilt bakımı"],
  [/masaj|terapi/i, "masaj"],
];

// Full-body expressions across all seven supported languages. Kept as one alternation so
// every equivalent collapses to the single canonical "full body" value at extraction time.
// German: "Ganzkörper(-Laserbehandlung/-Laserepilation/behandlung)", "am ganzen Körper",
// "vollständige Körperbehandlung". No \b around non-ASCII letters (outside JS \w).
const FULL_BODY_EXPRESSION =
  "(?:tüm|tum|tam|komple)[\\s\\-]v[uü]cut|full[\\s\\-]body|entire\\s+body|whole\\s+body" +
  "|ganzk[öo]rper|ganzen\\s+k[öo]rpers?|vollst[äa]ndige[nr]?\\s+k[öo]rperbehandlung" +
  "|كامل\\s+الجسم|الجسم\\s+بالكامل" +
  "|всего\\s+тела|вс[её]\\s+тело|полное\\s+тело" +
  "|corps\\s+entier|tout\\s+le\\s+corps|[ée]pilation\\s+int[ée]grale" +
  "|cuerpo\\s+completo|todo\\s+el\\s+cuerpo|depilaci[oó]n\\s+integral";

// Body-area patterns for laser epilasyon — most specific first.
// All full-body equivalents (7 languages) map to the single canonical "full body".
const TREATMENT_AREA_PATTERNS: Array<[RegExp, string]> = [
  [new RegExp(FULL_BODY_EXPRESSION, "i"), "full body"],
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
// Covers all seven supported languages: a "not my first time / I already had sessions"
// answer must be recognised in the SAME language the patient is conversing in, otherwise
// the laser qualification gate (firstTimeLaser) never resolves and the flow can never
// reach `complete`. Cyrillic/Arabic have no JS \b — use explicit context instead.
const FIRST_TIME_FALSE_PATTERNS: RegExp[] = [
  /daha\s+önce\s+yaptırd[ıi][mn]/i,
  /devam\s+ediyorum/i,
  /seanslar[ıi]m\s+var/i,
  /seans[ıi]m\s+var/i,
  /yarım\s+kald[ıi]/i,
  /tekrar\s+başla/i,
  /seansa?\s+devam/i,
  /önceden\s+yaptırd[ıi][mn]/i,
  // English — "not my first time/visit/treatment/session". English had no negation guard,
  // so before this the affirmative patterns below (e.g. "first treatment") would misfire on
  // a returning patient's "no, not my first treatment". Checked first, so it wins.
  /\bnot\s+(?:my\s+|the\s+)?first\s+(?:time|visit|treatment|session)\b/i,
  // German — "not the first time", "already had some sessions / started"
  /\bnicht\s+(?:mein\s+|das\s+)?erste[sn]?\s+mal\b/i,
  /\bschon\s+(?:einige|mehrere|ein\s+paar|paar|mal|einmal)\b/i,
  /\bbereits\s+(?:behandelt|begonnen|angefangen|gemacht|sitzungen)\b/i,
  /\bwar\s+schon\b/i,
  // French — "not my first time/treatment/session", "already did / had / started"
  /pas\s+(?:mon\s+|ma\s+|la\s+|sa\s+)?premi(?:er|[eè]re)\s+(?:fois|traitement|s[ée]ance|[ée]pilation)/i,
  /d[ée]j[àa]\s+(?:fait|eu|commenc[ée]|essay[ée])/i,
  // Spanish — "it's not my first time/session/treatment", "I already did it"
  /no\s+(?:es|era)\s+(?:mi\s+|la\s+|su\s+)?primer(?:a)?\s+(?:vez|sesi[oó]n|tratamiento|depilaci[oó]n)/i,
  /ya\s+(?:lo\s+)?(?:he\s+)?(?:hecho|empec[ée]|comenc[ée]|realic[ée])/i,
  // Russian — "not the first time", "already did / went through"
  /не\s+впервые/i,
  /уже\s+(?:делал|делала|проходил|проходила|начал|начала)/i,
  // Arabic — "it's not the first time", "I have done this before"
  /ليست?\s+(?:هي\s+)?(?:المرة\s+)?الأولى/,
  /سبق\s+(?:لي|أن)/,
];

// First-time signals.
// Use [İi] explicitly — JavaScript regex /i flag does not map 'i' ↔ 'İ' (Turkish dotted-I).
// The non-Turkish/English languages were missing here, which meant a German (or French/
// Spanish/Russian/Arabic) patient answering "yes, first time" never set firstTimeLaser —
// so the laser flow stayed at collect_qualification forever and the booking-link handoff
// was permanently skipped with reason=not_complete.
const FIRST_TIME_TRUE_PATTERNS: RegExp[] = [
  /[İi]lk\s+kez/,
  /[İi]lk\s+defa/,
  /daha\s+önce\s+yaptırma[dm][ıi][mn]?/i,
  /hiç\s+yaptırma[dm][ıi][mn]?/i,
  /başlama[dm][ıi][mn]?/i,
  /yaptırmadım/i,
  /hiç\s+denemedim/i,
  // English — "first time/visit" plus "first (laser) treatment/session". The assistant's own
  // question says "first laser treatment", so a patient echoing that wording ("my first
  // treatment") must be recognised — matching only "first time" silently dropped the answer
  // and stalled the laser gate at collect_qualification forever.
  /\bfirst\s+time\b/i,
  /\bfirst\s+visit\b/i,
  /\bfirst\s+(?:laser\s+)?(?:treatment|session)\b/i,
  /\bnever\s+(?:done|had|been)\b/i,
  // German — "first time", "first (laser) treatment/session"
  /\bzum\s+ersten\s+mal\b/i,
  /\berste[sn]?\s+mal\b/i,
  /\berste\s+(?:laser)?(?:behandlung|sitzung)\b/i,
  // French — "first time / treatment / session / épilation", "never done/tried"
  /premi[eè]re\s+fois/i,
  /premi(?:er|[eè]re)\s+(?:traitement|s[ée]ance|[ée]pilation)/i,
  /jamais\s+(?:fait|essay[ée]|eu)/i,
  // Spanish — "first time / session / treatment / depilación", "never done it"
  /primera\s+vez/i,
  /primer(?:a)?\s+(?:sesi[oó]n|tratamiento|depilaci[oó]n)/i,
  /nunca\s+(?:lo\s+)?(?:he\s+)?hecho/i,
  // Russian — "first time", "never did"
  /впервые/i,
  /перв(?:ый|ая)\s+раз/i,
  /никогда\s+(?:не\s+)?(?:делал|делала|проходил|проходила)/i,
  // Arabic — "first time"
  /أول\s+مرة/,
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
  // English
  /how\s+much/i,
  /\bprice\b/i,
  /\bcost\b/i,
  /\brate\b/i,
  // German
  /kostet|\bpreis\b/i,
  // French
  /combien|co[uû]te|\bprix\b|\btarif\b/i,
  // Spanish
  /\bprecio\b|cuesta|cu[aá]nto\b/i,
  // Russian (no \b — Cyrillic is outside JS \w)
  /сколько\s+стоит|стоит|цена/i,
  // Arabic
  /سعر|تكلفة|كم\s+تكلف/,
];

// Graft count for hair transplant — captures the leading number before "greft/graft" (singular or plural)
const GRAFT_COUNT_RE = /(\d[\d.,]*)\s*(?:greft(?:s|ler)?|grafts?|grft)/i;

// Travelling from abroad vs already in Istanbul
const TRAVELLING_ABROAD_PATTERNS: RegExp[] = [
  /yurt\s*d[ıi]ş[ıi]ndan/i,
  /abroad/i,
  /(?:from|coming\s+from)\s+(?:the\s+)?(?:uk|usa|us|germany|france|italy|spain|netherlands|europe|overseas|outside)\b/i,
  /travel(?:l?ing)?\s+from\s+(?:the\s+)?(?:uk|usa|us|germany|france|italy|spain|netherlands|europe|overseas|outside)\b/i,
  /(?:coming|travelling|traveling|travel(?:l?ing)?)\s+to\s+istanbul/i,
  // Turkish patterns — avoid \b around Turkish chars; use word-start context instead.
  // Apostrophe class includes the straight quote: the sanitizer now PRESERVES apostrophes.
  /[İi]stanbul[''']?[ae]\s*(?:geliyorum|geleceğim|geliyo)/i,
  /seyahat\s+(?:ediyorum|edeceğim|edecek)/i,
  // German — "from abroad" / "coming/travelling/flying to Istanbul"
  /aus\s+dem\s+ausland|vom\s+ausland/i,
  /(?:komme|reise|fliege)\s+(?:nach\s+istanbul|aus\s+dem\s+ausland)/i,
  // French — "from abroad" / "I'm coming/travelling to Istanbul"
  /de\s+l['']?[ée]tranger/i,
  /(?:viens|venir|voyage|arrive)\s+(?:à|a)\s+istanbul/i,
  // Spanish — "from abroad" / "I travel/come to Istanbul" (Estambul)
  /del\s+extranjero|desde\s+el\s+extranjero/i,
  /(?:vengo|viajo|llego)\s+a\s+estambul/i,
  // Russian — "from abroad" / "coming to Istanbul" (Стамбул, accusative)
  /из-за\s+границы/i,
  /(?:приезжаю|прилетаю|еду)\s+в\s+стамбул\b/i,
  // Arabic — "from abroad" / "coming to Istanbul" (no JS \b — Arabic is outside \w)
  /من\s+الخارج/,
  /(?:قادم|أسافر|آتي)\s+إلى\s+[اإ]س[تط]ا?نبول/,
];

const ALREADY_LOCAL_PATTERNS: RegExp[] = [
  // Turkish İ — cannot use /i flag for dotted-I, explicit [İi] required.
  // Apostrophe class includes the straight quote: the sanitizer now PRESERVES apostrophes.
  /[İi]stanbul[''']?dayım/i,
  /[İi]stanbul[''']?da\s+(?:yaşıyor|oturuyor|bulun)/i,
  /(?:zaten|halihazırda)\s+(?:[İi]stanbul|türkiye|burada)/i,
  /(?:already|currently)\s+in\s+(?:istanbul|turkey)/i,
  /\blocal\b/i,
  // German — "I'm / I live in Istanbul (Turkey)", "already in Istanbul / der Türkei"
  /ich\s+(?:bin|wohne|lebe)\s+(?:schon\s+|bereits\s+|jetzt\s+)?in\s+(?:istanbul|der\s+t[üu]rkei)/i,
  /(?:schon|bereits)\s+in\s+(?:istanbul|der\s+t[üu]rkei)/i,
  // French — "I'm / I live in Istanbul / Turquie", "already in Istanbul"
  /(?:je\s+suis|j['']?habite|je\s+vis)\s+(?:déjà\s+)?(?:à|a|en)\s+(?:istanbul|turquie)/i,
  /déjà\s+(?:à|a|en)\s+(?:istanbul|turquie)/i,
  // Spanish — "I'm / I live in Estambul / Turquía", "already in Estambul"
  /(?:estoy|vivo|resido)\s+(?:ya\s+)?en\s+(?:estambul|turqu[ií]a)/i,
  /ya\s+(?:estoy\s+)?en\s+(?:estambul|turqu[ií]a)/i,
  // Russian — "I'm / I live in Istanbul / Turkey" (prepositional Стамбуле/Турции)
  /(?:я\s+)?(?:уже\s+)?(?:живу\s+)?в\s+(?:стамбуле|турции)/i,
  /уже\s+в\s+(?:стамбуле|турции)/i,
  // Arabic — "I'm / I live in Istanbul", "already in Istanbul / Turkey"
  /(?:أنا\s+)?(?:موجود\s+)?في\s+[اإ]س[تط]ا?نبول/,
  /أعيش\s+في\s+[اإ]س[تط]ا?نبول/,
  /بالفعل\s+في\s+(?:[اإ]س[تط]ا?نبول|تركيا)/,
];

// Dental treatment type — specific types only (generic "\bdiş\b" lives in SERVICE_PATTERNS)
const DENTAL_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/smile\s*design|gülüş\s*(?:tasarım|dizayn)/i, "smile design"],
  [/dental\s*implant|diş\s*implant|\bimplant\b/i, "implant"],
  [/veneer|diş\s*kaplama?|porselen\s*diş/i, "veneer"],
  [/diş\s*beyazlatma|teeth?\s*whiten|bleaching/i, "whitening"],
  [/ortodonti|braces|bracket/i, "orthodontics"],
  [/diş\s*dolgu|filling/i, "filling"],
];

// Teeth count or treatment scope for dental flow.
// Teeth nouns and scope words are covered across the seven supported languages so a
// non-TR/EN patient answering the scope question in their own language still sets
// teethCountOrScope — the dental completion gate. Cyrillic/Arabic are outside JS \w.
const TEETH_NOUN = "diş|tooth|teeth|z[äa]hne?|dents?|dientes?|зуб(?:ов|а|ы)?|أسنان|سن";
const TEETH_SCOPE_PATTERNS: Array<[RegExp, ((m: RegExpMatchArray) => string) | string]> = [
  [/full\s*smile(?:\s*design)?|tüm\s*(?:ağız|dişler?)/i, "full smile"],
  // Whole-mouth / full-arch scope across DE/FR/ES/RU/AR → same "full smile" value
  [/ganzes\s+gebiss|alle\s+z[äa]hne|komplettes\s+(?:gebiss|l[äa]cheln)/i, "full smile"],
  [/toutes\s+les\s+dents|sourire\s+complet|toute\s+la\s+bouche/i, "full smile"],
  [/todos\s+los\s+dientes|toda\s+la\s+boca|sonrisa\s+completa/i, "full smile"],
  [/все\s+зубы|весь\s+рот/i, "full smile"],
  [/كل\s+الأسنان|جميع\s+الأسنان|الفم\s+بالكامل/, "full smile"],
  [new RegExp(`(\\d+)\\s*(?:${TEETH_NOUN})`, "i"), (m: RegExpMatchArray) => `${m[1]} teeth`],
  // Front teeth — adjective-before-noun for Latin/Cyrillic; noun-before-adjective for Arabic
  [new RegExp(`(?:ön|front|vordere?|avant|frontales?|передни[ехй])\\s*(?:${TEETH_NOUN})|الأسنان\\s+الأمامية`, "i"), "front teeth"],
  [new RegExp(`(?:arka|back|hintere?|arri[èe]re|traseros?|задни[ехй])\\s*(?:${TEETH_NOUN})|الأسنان\\s+الخلفية`, "i"), "back teeth"],
  [new RegExp(`(?:birkaç|a\\s+few|some|einige|ein\\s+paar|quelques|algunos|несколько|بعض)\\s*(?:${TEETH_NOUN})`, "i"), "a few teeth"],
];

// Desired treatment timeline (month/date range signals, not a specific appointment day)
const TIMELINE_PATTERNS: RegExp[] = [
  /bu\s*ay(?!\s*için)|this\s*month/i,
  /gelecek\s*ay|next\s*month/i,
  /\d+\s*(?:hafta\s*(?:içinde|sonra)|weeks?\s*(?:from\s*now|later)?)/i,
  /\d+\s*(?:ay\s*(?:içinde|sonra)|months?\s*(?:from\s*now|later)?)/i,
  /bu\s*yaz|this\s*summer/i,
  /bu\s*yıl|this\s*year/i,
  /(?:en\s*kısa\s*sürede|asap|as\s*soon\s*as\s*possible)/i,
];

// Patient asking about open slots or appointment availability
const AVAILABILITY_INQUIRY_PATTERNS: RegExp[] = [
  /\bboş\s*(?:musunuz|mu|misiniz)\b/i,
  /\bmüsait\s*(?:musunuz|misiniz|mi)\b/i,
  /\brandevu\s+(?:var\s+mı|mevcut\s+mu|uygun\s+mu)\b/i,
  /\b(?:açık\s+mı|çalışıyor\s+musunuz)\b/i,
  /\b(?:available|any\s+slots?|slot\s+available)\b/i,
  /\bdo\s+you\s+have\s+(?:any\s+)?(?:slots?|appointments?|openings?)\b/i,
  /\bcan\s+I\s+(?:book|get|schedule)\s+(?:an?\s+)?appointment\b/i,
];

// Patient asking about clinic devices or technology brands.
// Turkish suffixed forms ("cihazını kullanıyorsunuz") and an interposed treatment word
// ("hangi lazer cihazı") are covered — [a-zçğışöü]* because Turkish letters are not \w.
const DEVICE_INQUIRY_PATTERNS: RegExp[] = [
  /\bhangi\s+(?:[a-zA-ZçğışöüÇĞİŞÖÜ]+\s+)?(?:cihaz|teknoloji|marka|sistem)/i,
  /cihaz[a-zçğışöü]*\s*(?:ne\b|nedir|kullan|var\s*m[ıi])/i,
  /teknoloji[a-zçğışöü]*\s*(?:ne\b|nedir|kullan)/i,
  /\b(?:which|what)\s+(?:\w+\s+)?(?:device|machine|technology|brand|equipment)\b/i,
  /\b(?:alexandrite|diode|nd[:\s]?yag|soprano|candela|fotona|lumenis|zimmer)\b/i,
];

// Patient asking about pre-treatment preparation
const PRE_TREATMENT_INQUIRY_PATTERNS: RegExp[] = [
  /\bhazırlık\b/i,
  /\b(?:nasıl|ne\s+şekilde)\s+hazırlanmalıyım\b/i,
  /\b(?:işlem|seans|tedavi)\s+(?:öncesi|öncesinde)\b/i,
  /\b(?:pre[- ]?treatment|before\s+(?:the\s+)?(?:session|treatment|appointment))\b/i,
  /\bwhat\s+(?:should|do)\s+I\s+(?:do|prepare|avoid|know)\s+before\b/i,
  /\b(?:should\s+I\s+shave|should\s+I\s+avoid|can\s+I\s+eat)\b/i,
];

// ── Informational-only message detection ─────────────────────────────────────
// Deterministic rule: a qualification question is appended ONLY when the message shows
// active treatment/appointment intent. Purely informational questions (location, metro,
// airport transfer, parking, device brand, Instagram channel) are answered and the
// conversation is left open — no automatic "Bu işlemi ilk kez mi yaptıracaksınız?".

// Clinic location / directions questions (question forms only — a patient GIVING their
// district, e.g. "Kadıköy şubesi uygun olur", must not match).
const LOCATION_INQUIRY_RE =
  /adres(?:iniz)?\s*(?:ne(?:dir)?|nerede|paylaş|alabilir)|nerede(?:siniz)?\b|konum(?:unuz)?\s*(?:ne(?:dir)?|nerede|paylaş)|yol\s*tarifi|nasıl\s+(?:gelebilirim|gelirim|ulaşırım|ulaşabilirim|giderim)|\bmetro\b|\bharita\b|\baddress\b|\bdirections?\b|where\s+(?:are\s+you|is\s+the\s+clinic)|how\s+(?:do|can)\s+i\s+(?:get|find|reach)|\bu-?bahn\b|wo\s+(?:ist|sind|finde)|\badresse\b|standort|\boù\b|d[oó]nde|direcci[oó]n|\bгде\b|адрес|أين|عنوان/i;

// Airport transfer / shuttle questions
const TRANSFER_INQUIRY_RE =
  /havaliman|havaalan|airport|\btransfer\b|shuttle|flughafen|a[eé]roport|aeropuerto|аэропорт|трансфер|مطار/i;

// Parking questions
const PARKING_INQUIRY_RE = /otopark|park\s*yeri|vale\b|parking|parkplatz|estacionamiento|парковк|موقف/i;

// Instagram contact-channel questions
const INSTAGRAM_INQUIRY_RE = /instagram|\binsta\b|\big\b|\bdm\b/i;

export function isLocationInquiry(message: string): boolean {
  return LOCATION_INQUIRY_RE.test(message);
}
export function isTransferInquiry(message: string): boolean {
  return TRANSFER_INQUIRY_RE.test(message);
}
export function isParkingInquiry(message: string): boolean {
  return PARKING_INQUIRY_RE.test(message);
}
export function isInstagramInquiry(message: string): boolean {
  return INSTAGRAM_INQUIRY_RE.test(message);
}

// Explicit "I want a treatment / when can I come / appointment planning" phrasing.
const WANT_TREATMENT_RE =
  /randevu|yaptırmak\s+istiyorum|istiyorum|gelmek\s+ist|ne\s+zaman\s+gelebilirim|planl[ıi]yorum|appointment|\bbook(?:ing)?\b|i\s+(?:want|would\s+like|need)\b|when\s+can\s+i\s+(?:come|visit)|planning\s+to\b|termin|rendez-vous|\bcita\b|запис|موعد/i;

/**
 * Strong treatment/appointment intent signals: any of these means the qualification
 * flow proceeds normally on this turn.
 */
function hasTreatmentIntent(message: string, slots: ExtractedSlots): boolean {
  return !!(
    slots.priceInquired ||
    slots.availabilityInquiry ||
    slots.preferredDate ||
    slots.preferredTime ||
    slots.firstTimeLaser !== undefined ||
    slots.estimatedGrafts !== undefined ||
    slots.travellingFromAbroad !== undefined ||
    slots.teethCountOrScope ||
    slots.dentalTreatmentType ||
    slots.treatmentTimeline ||
    WANT_TREATMENT_RE.test(message)
  );
}

/**
 * Deterministic gate for the "answer only, do not qualify" rule.
 *
 * True when the message is an informational-only question: device brand, clinic
 * location/directions, airport transfer, parking, Instagram channel — or a pre-treatment
 * question OUTSIDE an active qualification flow. Any strong treatment/appointment intent
 * signal (price, availability, date/time, wanting a treatment, qualification answers)
 * makes it false, so the flow still advances for real inquiries.
 *
 * Pre-treatment questions while the conversation is already mid-flow (service category
 * known and a collection stage active) are NOT informational-only: the assistant answers
 * the question AND continues with the missing qualification field.
 */
export function isInformationalOnlyMessage(
  message: string,
  slots: ExtractedSlots,
  state: { serviceCategory?: ServiceCategory; stage?: string }
): boolean {
  if (hasTreatmentIntent(message, slots)) return false;

  if (
    slots.deviceInquiry ||
    isInstagramInquiry(message) ||
    isTransferInquiry(message) ||
    isParkingInquiry(message) ||
    isLocationInquiry(message)
  ) {
    return true;
  }

  if (slots.preTreatmentInquiry) {
    const inActiveFlow =
      !!state.serviceCategory &&
      state.serviceCategory !== "other" &&
      (state.stage === "collect_qualification" ||
        state.stage === "collect_datetime" ||
        state.stage === "collect_name");
    return !inActiveFlow;
  }

  return false;
}

/**
 * Detects the high-level service category from a service name or treatment area string.
 * Used to drive flow-specific qualification questions.
 */
export function detectServiceCategory(service: string, treatmentArea?: string): ServiceCategory {
  const s = `${service} ${treatmentArea ?? ""}`.toLowerCase();
  if (/hair\s*transplant|saç\s*ekimi|sac\s*ekimi|greft|graft|\bfue\b|\bfut\b/.test(s)) return "hair_transplant";
  if (/implant|veneer|whitening|smile\s*design|beyazlatma|porselen|gülüş|diş\s*kaplama|\bdental\b/.test(s)) return "dental";
  if (/\bdiş\b/.test(s)) return "dental";
  if (/laser|lazer|epilasyon|botoks|dolgu|filler|cilt|estetik|facial/.test(s)) return "laser";
  return "other";
}

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

// Looks for explicit name introductions. Correction patterns come first so
// "Adım Zeynep değil, Ayşe" captures the corrected name ("Ayşe") instead of the
// generic prefix pattern capturing "Zeynep değil".
const NAME_PATTERNS: RegExp[] = [
  // Turkish correction: "Adım/İsmim <old> değil, <new>"
  /(?:[Bb]enim\s+)?(?:[Aa]d[ıi]m|[İi]smim)\s+\S+\s+değil[,.]?\s*([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+(?:\s+[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]+)?)/,
  // English correction: "My name is <new>, not <old>"
  /\b[Mm]y\s+name\s+is\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s*,\s*not\b/,
  // English introduction: "My name is <name>" — capitalized name word(s) only, so
  // lowercase continuations ("my name is on the form") are not captured
  /\b[Mm]y\s+name\s+is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
  /(?:[İi]sim|[Aa]d(?:ım)?)\s*:\s*([A-ZÇĞİÖŞÜa-zçğışöüI][A-Za-zÇĞİÖŞÜçğışöü]*)/,
  /\b(?:ben|benim adım|ismim|adım)\s+([A-ZÇĞİÖŞÜa-zçğışöüI]{2,}(?:\s+[A-ZÇĞİÖŞÜa-zçğışöüI]{2,})?)\b/i,
  /^([A-ZÇĞİÖŞÜ][a-zçğışöü]{1,}(?:\s+[A-ZÇĞİÖŞÜ][a-zçğışöü]{1,})?)\s+(?:olarak|aradım|yazıyorum|merhaba)\b/,
  // "Name, +phone" — comma followed by '+' makes this specific enough to avoid service-term false positives
  /^([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]{1,}(?:\s+[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğışöü]{1,})?)\s*,\s*\+/,
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
  // conversational status words (Turkish) — "gelmedi bir şey", "cevap gelmedi", etc.
  "gelmedi", "geldi", "cevap", "olmadı", "oldu", "bekliyorum", "bekliyoruz",
  "şey", "bir", "ne", "henüz", "hala", "hâlâ", "mesaj", "dönüş",
  // conversational status words (English) — "nothing happened", "no reply", etc.
  "nothing", "happened", "reply", "waiting", "still", "arrive", "arrived",
  "did", "not", "yet", "it", "hello", "hi", "thanks", "thank", "okay", "yes",
]);

// Conversational status phrases that must never be treated as a patient name by the
// bare-word fallback. A patient reporting "gelmedi bir şey" (nothing arrived) or
// "no reply" is talking about the conversation, not introducing themselves.
const CONVERSATIONAL_PHRASE_PATTERNS: RegExp[] = [
  /gelmedi/i,                                 // "gelmedi bir şey", "cevap gelmedi", "mesaj gelmedi"
  /\bcevap\b/i,
  /olmad[ıi]/i,                               // "olmadı"
  /\btamam\b/i,
  /bekliyor/i,                                // "bekliyorum", "bekliyoruz", "hâlâ bekliyor"
  /\bne\s+oldu\b/i,
  /\bnothing\s+happened\b/i,
  /\bno\s+reply\b/i,
  /\b(?:did\s+not|didn['’]?t)\s+arrive\b/i,   // "it did not arrive"
  /\bstill\s+waiting\b/i,
];

// Pure Turkish/Latin letters, 1 or 2 words, no digits or punctuation
const BARE_NAME_RE = /^[A-ZÇĞİÖŞÜa-zçğışöü]{2,}(?:\s+[A-ZÇĞİÖŞÜa-zçğışöü]{2,})?$/;

// Self-introduction prefixes already covered by NAME_PATTERNS, but strip here too for safety
const NAME_INTRO_RE = /^(?:ben(?:\s+adım)?|benim\s+adım|ismim|adım|adı)\s+/i;

// Matches the exact canonical forms that all normalize to "full body".
// Used to de-dup legacy stored values like "tüm vücut" in detectConflict.
const FULL_BODY_CANONICAL_RE = new RegExp(`^(?:${FULL_BODY_EXPRESSION})$`, "i");

/**
 * Maps known equivalent treatment-area phrases to one canonical internal value.
 * Handles legacy Redis values stored before normalization was added (e.g. "tüm vücut").
 * Only full-body equivalents are collapsed — other areas are returned unchanged.
 */
export function normalizeTreatmentArea(area: string): string {
  if (FULL_BODY_CANONICAL_RE.test(area.trim())) return "full body";
  return area;
}

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

  // Conversational status phrases are never names, whatever their shape.
  if (CONVERSATIONAL_PHRASE_PATTERNS.some((p) => p.test(trimmed))) return undefined;

  const stripped = trimmed.replace(NAME_INTRO_RE, "").trim();
  const words = stripped.split(/\s+/);

  // A bare-name reply is 1–2 words. Longer messages are sentences ("gelmedi bir şey"),
  // so reject them outright instead of guessing a "name" from the first two words.
  if (words.length > 2) return undefined;

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
  if (slots.travellingFromAbroad && hasService) return "hot";
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

  // Detect service category from whatever service/area was extracted in this message.
  if (result.service) {
    result.serviceCategory = detectServiceCategory(result.service, result.treatmentArea);
  }

  // Detect dental treatment type when service is dental-family
  if (result.serviceCategory === "dental" || /implant|veneer|whitening|smile\s*design|beyazlatma|porselen|gülüş|\bdiş\b|\bdental\b/i.test(message)) {
    for (const [pattern, type] of DENTAL_TYPE_PATTERNS) {
      if (pattern.test(message)) {
        result.dentalTreatmentType = type;
        break;
      }
    }
  }

  // Detect teeth count / scope for dental flow
  for (const [pattern, resolver] of TEETH_SCOPE_PATTERNS) {
    const m = message.match(pattern as RegExp);
    if (m) {
      result.teethCountOrScope = typeof resolver === "function" ? resolver(m) : resolver;
      break;
    }
  }

  // Detect graft count for hair transplant
  const graftMatch = message.match(GRAFT_COUNT_RE);
  if (graftMatch) {
    const raw = graftMatch[1].replace(/[.,]/g, "");
    const num = parseInt(raw, 10);
    if (!isNaN(num) && num > 0) result.estimatedGrafts = num;
  }

  // Detect travelling from abroad vs already local
  if (ALREADY_LOCAL_PATTERNS.some((p) => p.test(message))) {
    result.travellingFromAbroad = false;
  } else if (TRAVELLING_ABROAD_PATTERNS.some((p) => p.test(message))) {
    result.travellingFromAbroad = true;
  }

  // Detect treatment timeline (month/season range, not a specific appointment day)
  if (TIMELINE_PATTERNS.some((p) => p.test(message))) {
    const tlMatch = TIMELINE_PATTERNS.find((p) => p.test(message));
    if (tlMatch) {
      const m = message.match(tlMatch);
      if (m) result.treatmentTimeline = m[0].trim();
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

  // Detect availability inquiry (patient asking about open slots)
  if (AVAILABILITY_INQUIRY_PATTERNS.some((p) => p.test(message))) {
    result.availabilityInquiry = true;
  }

  // Detect device/technology inquiry
  if (DEVICE_INQUIRY_PATTERNS.some((p) => p.test(message))) {
    result.deviceInquiry = true;
  }

  // Detect pre-treatment preparation inquiry
  if (PRE_TREATMENT_INQUIRY_PATTERNS.some((p) => p.test(message))) {
    result.preTreatmentInquiry = true;
  }

  // Record detected language for prompt/reply context. Only persist a CONFIDENT detection:
  // a language-neutral message (e.g. "Zeynep, +44 7700 900123") must NOT overwrite the
  // established conversation language, otherwise completion/link replies would flip to
  // English on the final turn. Leaving it undefined lets updateState() keep the prior value.
  const confidentLanguage = detectMessageLanguageConfident(message);
  if (confidentLanguage) result.detectedLanguage = confidentLanguage;

  result.leadScore = calculateLeadScore(result);

  return result;
}

// Distinctive English signals — common function words plus clinic vocabulary. Used to
// decide whether a Latin-script message is CONFIDENTLY English, as opposed to a
// language-neutral message that carries no signal at all (e.g. a bare "Zeynep, +44 7700
// 900123", which is just a name and a phone number).
const ENGLISH_SIGNAL_RE =
  /\b(hi|hello|hey|yes|no|first|time|name|my|the|is|are|please|book|booking|appointment|available|availability|today|tomorrow|morning|afternoon|evening|how|much|price|cost|want|need|would|like|thanks|thank|hair|transplant|teeth|tooth|dental|smile|grafts?|from|abroad|full|body|sessions?|laser|for)\b/i;

/**
 * Confident language detection. Returns null when the message carries NO positive
 * language signal (for example only a name and a phone number). Unlike
 * detectMessageLanguage(), it never defaults to "english" — callers use the null result
 * to PRESERVE the established conversation language instead of resetting it to English.
 * Covers 7 languages common in premium international clinic markets.
 * Turkish-specific chars (ğ, ı, İ, Ğ) are the strongest Turkish signal.
 */
export function detectMessageLanguageConfident(message: string): MessageLanguage | null {
  // Turkish: dotted-I and ş/ğ chars are unambiguous; fall back to Turkish keywords
  if (/[ğıİĞşŞ]/.test(message)) return "turkish";
  if (/\b(merhaba|lazer|epilasyon|fiyat|randevu|için|istiyorum|uygun|tamam|evet|teşekkür)\b/i.test(message)) return "turkish";
  // Arabic script
  if (/[؀-ۿ]/.test(message)) return "arabic";
  // Cyrillic (Russian and related)
  if (/[а-яёА-ЯЁ]/.test(message)) return "russian";
  // German: ä/Ä are low-overlap; ö/ü shared with Turkish (already checked) and French
  if (/[äÄß]/.test(message) || /\b(wie|viel|kostet|termin|behandlung|preis|hallo|guten|möchte|haar(?:entfernung|transplantation))\b/i.test(message)) return "german";
  // French: distinctly French chars (à, â, ê, î, ô, œ, etc.) or keywords
  if (/[àâæêîïôœùûÿÀÂÆÊÎÏÔŒÙÛŸ]/.test(message) || /\b(bonjour|bonsoir|combien|traitement|rendez-vous|épilation|prix|merci|greffe|cheveux)\b/i.test(message)) return "french";
  // Spanish: inverted punctuation, ñ, or common clinic keywords
  if (/[¿¡ñÑ]/.test(message) || /\b(hola|precio|cu[aá]nto|tratamiento|depilaci[oó]n|gracias|cita|dientes|injerto)\b/i.test(message)) return "spanish";
  // English: only when a positive English signal is present — never as a bare default.
  if (ENGLISH_SIGNAL_RE.test(message)) return "english";
  return null;
}

/**
 * Returns the likely language of a message, defaulting to "english" when no signal is
 * present. Kept for callers that always need a concrete language (e.g. conflict prompts).
 */
export function detectMessageLanguage(message: string): MessageLanguage {
  return detectMessageLanguageConfident(message) ?? "english";
}

// Canonical keys — cross-language equivalents within a service family share one key.
const LASER_CANONICAL = "__laser__";
const LASER_SERVICE_RE = /^(?:laser\s+hair\s+removal|lazer\s+epilasyon|epilasyon)$/i;

// All hair-transplant service names collapse to one canonical so Turkish/English
// variants (saç ekimi ↔ hair transplant) and graft-count-derived names don't conflict.
const HAIR_CANONICAL = "__hair__";
const HAIR_SERVICE_RE = /^(?:hair\s*transplant|saç\s*ekimi|sac\s*ekimi)$/i;

// All dental service sub-types (veneer ↔ smile design ↔ implant ↔ whitening) map to
// one canonical to avoid false conflicts when a patient refines their dental interest.
const DENTAL_CANONICAL = "__dental__";
const DENTAL_SERVICE_RE = /^(?:dental|smile\s*design|veneer|implant|whitening|orthodontics|filling|extraction)$/i;

function normalizeServiceCrossLang(service: string): string {
  if (LASER_SERVICE_RE.test(service.trim())) return LASER_CANONICAL;
  if (HAIR_SERVICE_RE.test(service.trim())) return HAIR_CANONICAL;
  if (DENTAL_SERVICE_RE.test(service.trim())) return DENTAL_CANONICAL;
  return service.toLowerCase();
}

export function detectConflict(
  state: ConversationState,
  extracted: ExtractedSlots,
  latestMessage?: string
): string | null {
  const lang = latestMessage ? detectMessageLanguage(latestMessage) : "english";

  if (state.treatmentArea && extracted.treatmentArea) {
    const stateNorm = normalizeTreatmentArea(state.treatmentArea);
    const extractedNorm = normalizeTreatmentArea(extracted.treatmentArea);
    if (stateNorm !== extractedNorm) {
      if (lang === "turkish") {
        return `Daha önce ${state.treatmentArea} bölgesi için bilgi almıştınız. Hangi bölgeyi kastediyorsunuz: ${extracted.treatmentArea} mi yoksa ${state.treatmentArea} mı?`;
      }
      return `You mentioned ${state.treatmentArea} earlier. Which area did you mean: ${extracted.treatmentArea} or ${state.treatmentArea}?`;
    }
  }
  if (state.service && extracted.service) {
    if (normalizeServiceCrossLang(state.service) !== normalizeServiceCrossLang(extracted.service)) {
      if (lang === "turkish") {
        return `Daha önce ${state.service} hakkında konuşmuştuk. ${extracted.service} mi demek istediniz?`;
      }
      return `We were discussing ${state.service} earlier. Did you mean ${extracted.service} instead?`;
    }
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
  travellingFromAbroad?: boolean;
  estimatedGrafts?: number;
}): LeadScore {
  const hasService = !!(state.service || state.treatmentArea);
  const hasDateTime = !!(state.preferredDate || state.preferredTime);
  const hasContact = !!(state.name || state.phone);
  const isUrgent = state.urgency === "high";

  if (isUrgent) return "hot";
  if (hasService && hasDateTime && hasContact) return "hot";
  if (hasService && hasDateTime) return "hot";
  if (state.travellingFromAbroad && hasService) return "hot";
  if (state.priceInquired && hasService && hasDateTime) return "hot";
  if (state.priceInquired && hasService) return "warm";
  if (hasService) return "warm";
  if (hasDateTime) return "warm";
  return "cold";
}
