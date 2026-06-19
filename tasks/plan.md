# Plan: Landing Page — Sales-Ready & Demo-Ready

**Branch:** add-agent-skills-workflow  
**Spec:** SPEC.md (Landing Page section)  
**Approved decisions:** See product decisions below  
**Do not modify code until a task is started.**

---

## Approved product decisions

| Decision | Value |
|---|---|
| Hero headline | "Kliniğiniz meşgulken WhatsApp'tan gelen randevu taleplerini otomatik karşılayın." |
| Sub-headline | "RandevuFlow; lazer ve estetik klinikleri için WhatsApp'tan gelen müşteri mesajlarını karşılar, hizmet–tarih–isim–telefon bilgisini toplar ve sıcak lead'i size bildirir." |
| Trust signal | "İlk pilot işletmelerle birebir kurulum ve manuel kalite kontrol." — no fake metrics or fake testimonials |
| WhatsApp number | No real number confirmed — replace all `905XXXXXXXXX` with `mailto:yigitalpyazici53@gmail.com?subject=RandevuFlow Pilot Başvurusu` |
| Mobile hero visual | Do not hide — show a compact proof card (customer message + assistant reply + owner alert) on mobile |

---

## Dependency order

```
Task 1 (CTA / WhatsApp → mailto)         ← independent, safe to do first
Task 2 (Hero text)                        ← independent
Task 3 (Mobile hero proof card)           ← independent
Task 4 (3-step How It Works section)      ← independent
Task 5 (Move demo section up)             ← independent, structural reorder
Task 6 (Pricing section headline)         ← independent
Task 7 (Final CTA differentiation)        ← independent
Task 8 (Trust signal strip)               ← independent
```

All tasks are independent and touch disjoint parts of `app/page.tsx`.  
Implement in order 1 → 8. Verify each task before starting the next.

---

## Task 1 — Replace WhatsApp placeholder with mailto CTA

**File:** `app/page.tsx`  
**What:** Replace the `WHATSAPP_URL` constant and every button/link that uses it.

**Current:**
```ts
const WHATSAPP_URL = "https://wa.me/905XXXXXXXXX";
```

**After:**
```ts
const CONTACT_URL = "mailto:yigitalpyazici53@gmail.com?subject=RandevuFlow%20Pilot%20Ba%C5%9Fvurusu";
```

Replace all `href={WHATSAPP_URL}` with `href={CONTACT_URL}`.  
Replace all `target="_blank" rel="noopener noreferrer"` on mailto links — remove `target="_blank"` (mailto does not open a new tab).  
Keep the green WhatsApp button style — the color is branding, not tied to the URL scheme.  
Update all visible button labels that say "WhatsApp'tan demo isteyin" → "Pilot başvurun" or "Demo isteyin" (no WhatsApp mention — the link is now email).

**Nav CTA:** `"Demo iste"` → `"Pilot başvurun"`  
**Hero button:** `"WhatsApp'tan demo isteyin"` → `"Pilot başvurun"`  
**Pricing Pilot card button:** `"Başlamak istiyorum"` → keep (still works with mailto)  
**Pricing Standart button:** `"Bilgi al"` → keep  
**Pricing Klinik button:** `"Teklif isteyin"` → keep  
**Final CTA button:** `"WhatsApp'tan demo isteyin"` → `"Pilot başvurun"`  
**Sticky button:** `"Demo iste"` → `"Demo iste"` (keep short, fine)  

**Verify (desktop + mobile):**
- No visible `905XXXXXXXXX` text anywhere on the page
- All CTA buttons open the user's mail client with pre-filled subject "RandevuFlow Pilot Başvurusu"
- No button says "WhatsApp" in its label while linking to email

---

## Task 2 — Update hero headline and sub-headline

**File:** `app/page.tsx`  
**What:** Replace the `<h1>` text and the paragraph below it in the hero section.

**Current `<h1>`:**
```
Instagram ve WhatsApp mesajlarını daha hızlı randevu talebine dönüştürün.
```

**New `<h1>`:**
```
Kliniğiniz meşgulken WhatsApp'tan gelen randevu taleplerini otomatik karşılayın.
```

**Current paragraph (`<p>`):**
```
RandevuFlow, lazer epilasyon ve estetik merkezleri için gelen "fiyat?" mesajlarını saniyeler içinde karşılar, müşteri bilgilerini toplar ve sıcak randevu taleplerini işletmenize bildirir.
```

**New paragraph:**
```
RandevuFlow; lazer ve estetik klinikleri için WhatsApp'tan gelen müşteri mesajlarını karşılar, hizmet–tarih–isim–telefon bilgisini toplar ve sıcak lead'i size bildirir.
```

**Keep:** Teal badge above the headline ("Lazer epilasyon ve estetik merkezleri"), benefit dots below the CTA, all styles.

**Verify (desktop + mobile):**
- New headline visible and legible at all breakpoints
- No truncation or layout break on iPhone SE (375px width)
- Old "daha hızlı" wording is gone

---

## Task 3 — Mobile hero proof card (remove hidden visual)

**File:** `app/page.tsx`  
**What:** The hero right panel (`className="hero-right"`) is hidden at ≤900px via `.hero-right { display: none !important; }` in the inline `<style>` block. Remove this suppression and replace it with a responsive layout.

**Desktop (≥900px):** Keep the existing two-column grid — left text, right panel with mini chat + lead notification card. No change.

**Mobile (<900px):**
- Single column, text first
- Below the CTA button, show a condensed **single proof card** instead of both cards:
  - A 3-bubble WhatsApp snippet (customer message → assistant reply → owner alert chip)
  - The owner alert card already in the right panel is sufficient on its own
- Remove `display: none !important` from `.hero-right` at mobile
- Instead, adjust padding/gap for the stacked layout

**Condensed mobile card spec:**
Show only the "hot lead notification" card (the dark card with amber "Yeni sıcak müşteri" header). It is the most impactful proof in the smallest space. The mini chat conversation card can remain desktop-only.

Implementation approach:
1. Remove the `display: none !important` rule for `.hero-right` in the `@media (max-width: 900px)` block
2. In the mobile media query, change `.hero-right` to `display: flex` but hide only the first child (the WhatsApp chat card) — keep the second child (lead notification card)
3. Add appropriate top margin/padding so the card doesn't crowd the CTA button

**Verify:**
- On desktop (≥900px): both chat card and lead card visible in right column
- On mobile (≤375px): lead notification card visible below the CTA — no horizontal scroll
- On mobile: chat card NOT shown (too wide for mobile)
- No layout shift or overflow at 375px, 390px, 414px widths

---

## Task 4 — Replace features grid with "Nasıl çalışır?" 3-step flow

**File:** `app/page.tsx`  
**What:** Replace the current 4-card features grid section entirely with a numbered 3-step flow.

**Section heading:** Keep "RandevuFlow nasıl çalışır?"  
**Section sub-heading:** Replace current sub with: "Siz işlemdeyken bile."

**3-step content:**

```
1. Müşteri mesaj atar
   WhatsApp veya Instagram'dan fiyat sorusu, randevu talebi veya bilgi isteği gelir.

2. RandevuFlow devreye girer
   Hizmet, tarih, isim ve telefon bilgisini otomatik toplar. Bilmediği şeyleri sormaz.

3. Siz bildirimi alırsınız
   Hazır randevu talebi, müşteri özeti ve önerilen aksiyon geliyor.
```

**Layout:**
- Horizontal on desktop (3 columns, step number + title + description)
- Vertical stack on mobile
- Step numbers: large teal numerals (e.g., `fontSize: "3rem"`, `color: C.teal`, `fontWeight: 800`)
- A subtle connector line or arrow between steps on desktop

**Remove:** The `.features-grid` CSS class and its 2-column grid rule (no longer needed). The 4 emoji feature cards are deleted entirely.

**Keep:** The section max-width, padding, and background (white).

**Verify:**
- 3 steps visible and in correct order on both desktop and mobile
- Step numbers legible and distinct
- No old feature cards visible
- Section does not break layout flow into the next section

---

## Task 5 — Move demo conversation section above pricing

**File:** `app/page.tsx`  
**What:** Reorder sections so the demo conversation (id="demo") appears immediately after the "Nasıl çalışır?" section, before the pricing section.

**Current order:**
1. Nav
2. Hero
3. Problem
4. Features (→ replaced by 3-step in Task 4)
5. Demo conversation
6. Pricing
7. FAQ
8. Final CTA
9. Compliance
10. Footer

**New order:**
1. Nav
2. Hero
3. Problem
4. How it works (3-step)
5. **Demo conversation** ← moved up from position 5 (no change in content)
6. Pricing
7. FAQ
8. Final CTA
9. Compliance
10. Footer

**What changes:** Only the JSX block order inside the returned `<div>`. No content or style edits.

**Verify:**
- Scrolling from top to bottom shows the demo conversation before the pricing section
- Section backgrounds alternate correctly (bgAlt → white → bgAlt → white → dark → bgAlt → dark)
- No section IDs or anchors break

---

## Task 6 — Update pricing section headline and trust signal

**File:** `app/page.tsx`  
**What:** Two changes in the pricing section.

**Change A — Section headline:**  
Current: `"İlk kurucu müşterilere özel pilot fiyat"`  
New: `"İlk üç klinikten biriyle çalışmak istiyoruz."`

**Change B — Section sub-text:**  
Current: `"Sistemi gerçek müşteri akışınızda test edin. Kurulum, kişiselleştirme ve ilk optimizasyon sizin için yapılır."`  
New: `"Sistemi gerçek akışınızda kurarız. 7 gün içinde sonuçları birlikte değerlendiririz."`

**No changes to:** prices, tier names, feature lists, card styles.

**Verify:**
- New headline visible above the pricing cards
- Old "kurucu müşterilere özel" wording is gone
- Pricing card content unchanged

---

## Task 7 — Differentiate final CTA section

**File:** `app/page.tsx`  
**What:** Replace the final CTA section headline and sub-copy so it is not a repeat of the hero.

**Current headline:** `"Bir sonraki 'fiyat?' mesajını kaçırmayın."`  
**New headline:** `"Merkeziniz için ücretsiz kurulum demosu yapalım."`

**Current sub-copy:** `"RandevuFlow'un merkeziniz için nasıl çalışacağını 1 dakikalık demo ile görün."`  
**New sub-copy:** `"Hangi hizmetleri sunduğunuzu anlatın. Sistemi size özel yapılandıralım. Birlikte test edelim."`

**Button label:** Already handled in Task 1 (→ "Pilot başvurun").

**Keep:** Dark gradient background, button style.

**Verify:**
- New headline and sub-copy visible in the final dark section
- No repetition with hero headline on the page
- Button links to correct mailto (covered by Task 1)

---

## Task 8 — Add trust signal strip below pricing

**File:** `app/page.tsx`  
**What:** Add a minimal trust strip below the pricing cards and above the FAQ section.

**Content (single centered line):**
```
İlk pilot işletmelerle birebir kurulum ve manuel kalite kontrol.
```

**Visual style:**
- Centered text, `fontSize: "0.9rem"`, `color: C.textMuted`
- A small teal dot or checkmark icon before the text
- White background, padding `1.5rem 2.5rem`
- No border, no box — just a quiet line

**Do not add:**
- Star ratings
- User counts
- Testimonial quotes
- Fake logos

**Verify:**
- Strip visible between pricing cards and FAQ on desktop and mobile
- Text is legible, not bold, not prominent — supportive tone
- No fake metrics visible anywhere on the page

---

## Full acceptance criteria (after all 8 tasks)

| ID | Criterion | Desktop | Mobile |
|---|---|---|---|
| AC1 | Hero headline uses approved copy, no "daha hızlı" | ✓ | ✓ |
| AC2 | Hero sub-headline uses approved copy | ✓ | ✓ |
| AC3 | No visible placeholder number `905XXXXXXXXX` | ✓ | ✓ |
| AC4 | All CTA buttons open mailto with correct pre-filled subject | ✓ | ✓ |
| AC5 | No button label mentions "WhatsApp" while linking to email | ✓ | ✓ |
| AC6 | Hero lead notification card visible on mobile (≤375px) | — | ✓ |
| AC7 | Desktop hero right panel (chat + lead card) unchanged | ✓ | — |
| AC8 | Features grid replaced by 3-step numbered flow | ✓ | ✓ |
| AC9 | Demo conversation section appears before pricing on scroll | ✓ | ✓ |
| AC10 | Pricing headline updated — no "kurucu müşterilere özel" | ✓ | ✓ |
| AC11 | Final CTA headline differentiated from hero | ✓ | ✓ |
| AC12 | Trust signal strip visible below pricing, no fake metrics | ✓ | ✓ |
| AC13 | No horizontal scroll at 375px width | — | ✓ |
| AC14 | FAQ section content unchanged | ✓ | ✓ |
| AC15 | KVKK compliance note unchanged | ✓ | ✓ |
| AC16 | Teal color palette, Outfit font, sticky button unchanged | ✓ | ✓ |

---

## Files changed (complete list)

| File | Tasks | Change summary |
|---|---|---|
| `app/page.tsx` | 1–8 | All changes — hero text, CTA URLs, hero mobile layout, 3-step section, section reorder, pricing headline, final CTA, trust strip |

No other files changed.

---

## Boundaries (from SPEC)

| Rule |
|---|
| Never add fake metrics, star ratings, or user counts |
| Never add a contact form — mailto is the intentional CTA |
| Never add animations that cause layout shift |
| Never change pricing amounts or tier names |
| Never add a testimonial without a real quote from a real person |
| Do not modify FAQ content |
| Do not modify the KVKK compliance note |
| Do not touch any file outside `app/page.tsx` |
