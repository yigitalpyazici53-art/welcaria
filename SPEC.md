# SPEC: Landing Page — Sales-Ready & Demo-Ready

**Status:** Awaiting approval  
**Scope:** `app/page.tsx` only (single file, all inline styles)  
**Goal:** Make the RandevuFlow landing page stronger for first-impression demos and pilot outreach to laser/aesthetic clinic owners

---

## 1. Current Page Audit

### What the page has (section by section)

| Section | Content | Status |
|---|---|---|
| Nav | Logo + "Demo iste" WhatsApp CTA | Keep, minor tweak |
| Hero | Headline + para + CTA + mini chat/lead card (hidden on mobile) | Needs work |
| Problem | Red-bordered pain point list | Keep as-is |
| Features (4 cards) | Anında cevap, müşteri niteleme, sıcak lead, takip | Refactor → 3-step flow |
| Demo conversation | Full Zeynep WhatsApp exchange + owner alert card | Keep, move up |
| Pricing | 3 tiers with actual TL prices | Keep structure, soften Pilot pitch |
| FAQ | 5 items (KVKK, kurulum, iptal, tıbbi tavsiye) | Keep |
| Final CTA | Dark gradient, repeats hero CTA | Differentiate text |
| Compliance note | KVKK disclaimer | Keep |
| Footer | One-liner | Keep |
| Sticky WA button | Fixed bottom-right | Keep |

### What is WEAK

**W1 — Hero is invisible on mobile.**  
The hero right panel (WhatsApp chat preview + hot lead card) is `display: none !important` on `max-width: 900px`. Turkish SMB owners browse on mobile. The most persuasive visual proof disappears on the device most likely to be used.

**W2 — Hero headline is vague.**  
"Instagram ve WhatsApp mesajlarını daha hızlı randevu talebine dönüştürün" — "daha hızlı" (faster) says nothing. The actual claim is that it happens automatically, without the owner being present.

**W3 — No 3-step flow.**  
Features are four parallel cards. There is no narrative of: (1) customer writes → (2) AI handles it → (3) owner gets a hot lead. A clinic owner needs a mental model before caring about feature names.

**W4 — Demo conversation is section 4.**  
The most concrete proof — Zeynep's conversation turning into a lead card — is buried after the problem section and features section. Many mobile visitors will not reach it.

**W5 — No trust signal.**  
No "built by", no "being piloted at", no human signal. For a new service asking for 3,500 TL/month, absence of any social proof is a friction point.

**W6 — Pilot CTA lacks urgency framing at section level.**  
The "İlk 3 işletmeye özel" badge is inside the pricing card. There is no section-level headline communicating that the pilot slots are genuinely limited and early.

**W7 — Final CTA is a copy of the hero CTA.**  
"Bir sonraki 'fiyat?' mesajını kaçırmayın. WhatsApp'tan demo isteyin." — same message, same button. Someone who scrolled to the bottom has already seen this. The final CTA should acknowledge that they read the page and give them one clear next step.

**W8 — WhatsApp number is a placeholder.**  
`WHATSAPP_URL = "https://wa.me/905XXXXXXXXX"` — must be replaced before any demo link is shared.

### What should STAY (do not touch)

- Color palette (teal + WhatsApp green + dark bg)
- Problem section — emotionally correct, well-formatted
- FAQ content — trust-critical (KVKK, tıbbi tavsiye)
- Demo conversation data (Zeynep) and owner notification card — best proof on the page
- Honest pricing — no fake "free" tier, no fake metrics
- Sticky WhatsApp button
- Turkish language throughout
- KVKK compliance note

---

## 2. Recommended Messaging

### Positioning statement (internal reference)

> RandevuFlow, lazer epilasyon ve estetik merkezleri için WhatsApp ve Instagram mesajlarını 7/24 otomatik olarak karşılar, müşteri bilgisini toplar ve sıcak randevu taleplerini işletmeye bildirir. Siz işlemdeyken.

### Hero headline options (pick one)

**Option A (outcome-first):**
> "Fiyat sorarken gelen müşteri, siz işlemdeyken randevuya dönüşsün."

**Option B (problem-first):**
> "Geç yanıt vermek yüzünden kaybettiğiniz müşteriler artık geçmişte kalsın."

**Option C (capability-first, current style):**
> "7/24 otomatik yanıt. Her 'fiyat?' mesajı sıcak randevu talebine."

Recommendation: **Option A** — clearest before/after for a clinic owner.

### Sub-headline (replace current paragraph)

> Müşteri WhatsApp'a yazıyor. RandevuFlow saniyeler içinde karşılıyor, hizmet bilgisini öğreniyor, uygun zamanı soruyor ve iletişim bilgilerini alıyor. Siz bildirimi görüyorsunuz.

### Social proof line (minimal, honest)

Since there are no live customers yet, use founder trust instead of fake metrics:

> "Kurucu ekibi tarafından geliştirilmektedir. İlk pilot kliniği arıyoruz."

Or, if there is even one test pilot:

> "İstanbul'da bir estetik merkezinde aktif olarak test ediliyor."

**Rule: Never claim a number you cannot prove.**

### Pilot CTA section headline (replace "İlk kurucu müşterilere özel pilot fiyat")

> "İlk üç klinikten biriyle çalışmak istiyoruz."

Sub: "Sistemi gerçek akışınızda kurarız. 7 gün içinde sonucu birlikte değerlendiririz."

---

## 3. Section-by-Section Change Plan

### Section: Nav
**Change:** No structural changes. Replace placeholder WhatsApp number before demo.  
**Keep:** Logo, "Demo iste" button.

---

### Section: Hero
**Change A — Headline.**  
Replace current headline with Option A from recommended messaging above.

**Change B — Sub-paragraph.**  
Replace with the tighter sub-headline from recommended messaging.

**Change C — Mobile hero visual.**  
The right panel (chat + lead card) must be visible on mobile. Options:
- Remove `display: none !important` from `.hero-right` at `max-width: 900px`
- Show a condensed single card (just the hot lead notification) on mobile instead of both cards
- Stack the visual below the CTA on mobile instead of hiding it

Recommended: Show just the lead notification card below the CTA on mobile (≤900px). It is smaller and still proves the concept.

**Keep:** Teal badge ("Lazer epilasyon ve estetik merkezleri"), benefit dots, WhatsApp button.

---

### Section: Problem
**No changes.** Content and design are correct.

---

### Section: Features → replace with "Nasıl çalışır?" 3-step flow
**Change:** Replace the 4-card features grid with a numbered 3-step flow:

1. **Müşteri mesaj atar** — WhatsApp veya Instagram'dan gelir. Siz işlemdeysiniz.
2. **RandevuFlow devreye girer** — Hizmet, zaman ve iletişim bilgisini otomatik olarak toplar.
3. **Siz bildirimi alırsınız** — Sıcak müşteri özeti, hazır randevu talebiyle birlikte gelir.

Each step has a number, a short title, and 1-sentence description. No feature jargon.

**Keep after the 3-step flow:** A 2-col grid of 4 supporting detail chips (Anında cevap, Müşteri niteleme, Sıcak lead bildirimi, Takip mesajları) — smaller, supporting role.

---

### Section: Demo Conversation
**Change — Move up in page order.**  
Current order: Problem → Features → Demo → Pricing  
New order: Problem → How it works (3 steps) → Demo → Pricing

**Change — Section headline.**  
Current: "Gerçek bir fiyat sorusu nasıl randevuya dönüşür?"  
Keep this — it is clear and concrete.

**Keep:** All conversation messages, the Zeynep example, the owner notification card.

---

### Section: Pricing
**Change — Section headline.**  
Replace "İlk kurucu müşterilere özel pilot fiyat" with:  
"İlk üç klinikten biriyle çalışmak istiyoruz."

**Change — Pilot card badge.**  
"İlk 3 işletmeye özel" is fine but add scarcity context at the section level, not just the card.

**Keep:** All prices, all feature lists, all 3 tiers. Do not invent new tiers.

---

### Section: FAQ
**No changes.** Content is trustworthy and appropriately cautious.

---

### Section: Final CTA
**Change — Headline.**  
Replace: "Bir sonraki 'fiyat?' mesajını kaçırmayın."  
With: "Merkeziniz için ücretsiz kurulum demosu yapalım."

**Change — Sub-copy.**  
Replace: "RandevuFlow'un merkeziniz için nasıl çalışacağını 1 dakikalık demo ile görün."  
With: "Hangi hizmetleri sunduğunuzu anlatın. Sistemi size özel yapılandıralım. Birlikte test edelim."

**Keep:** Button style and WhatsApp link.

---

### Section: Compliance note + Footer
**No changes.**

---

### Section: Sticky WhatsApp Button
**No changes.**

---

## 4. Acceptance Criteria

| ID | Criterion |
|---|---|
| AC1 | Hero headline updated to chosen option — "daha hızlı" removed |
| AC2 | Hero sub-paragraph replaced with tighter version |
| AC3 | Hero visual (chat/lead card) visible on mobile — not hidden at ≤900px |
| AC4 | Features section replaced with numbered 3-step "Nasıl çalışır?" flow |
| AC5 | Demo section appears before pricing in page scroll order |
| AC6 | Pricing section headline updated (no "kurucu müşterilere özel") |
| AC7 | Final CTA headline and sub-copy differentiated from hero |
| AC8 | No fake metrics, no fake testimonials, no unverifiable claim |
| AC9 | Page is readable and functional on iPhone SE width (375px) — no horizontal scroll, no hidden key content |
| AC10 | WhatsApp placeholder (`905XXXXXXXXX`) replaced with real number before any live link is shared |
| AC11 | All existing FAQ content preserved unchanged |
| AC12 | KVKK compliance note preserved |
| AC13 | Teal color palette, font (Outfit), and sticky WhatsApp button unchanged |

---

## 5. Out-of-Scope Boundaries

| Category | Rule |
|---|---|
| **Never** | Add fake review counts, star ratings, or "500+ clinics" style metrics |
| **Never** | Add a dashboard feature or screenshot — the product has no dashboard |
| **Never** | Claim the AI is GPT-4 or name any specific model |
| **Never** | Add a contact form — WhatsApp is the intentional CTA |
| **Never** | Add animations that increase layout shift or reduce mobile load speed |
| **Out of scope now** | A/B testing or analytics integration |
| **Out of scope now** | Multi-language support (EN) |
| **Out of scope now** | Blog, case study, or resources section |
| **Out of scope now** | Any backend change — this is a static page only |
| **Out of scope now** | Changing the pricing tiers or amounts |
| **Out of scope now** | Adding a video embed |
| **Confirm first** | Any new section not listed in this spec |
| **Confirm first** | Changing the pricing amounts or tier names |
| **Confirm first** | Adding a testimonial — only with a real quote from a real person |

---

## 6. Open Questions (answer before implementation begins)

**Q1 — Hero headline:**  
Which option do you prefer? Option A ("Fiyat sorarken gelen müşteri..."), B ("Geç yanıt vermek yüzünden..."), or C (current-style capability statement)?

**Q2 — Trust signal:**  
Is there a real pilot clinic or test partner? If yes, one honest sentence about it would be the strongest trust signal available. If no, use the "kurucu ekibi" framing.

**Q3 — WhatsApp number:**  
What is the real WhatsApp number to replace `905XXXXXXXXX`?

**Q4 — Mobile hero:**  
Preference for mobile layout: (A) show only the lead notification card below the CTA, (B) show a condensed version of both cards stacked, or (C) keep text-only on mobile?
