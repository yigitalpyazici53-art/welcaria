# RapidFlow Plumbing — AI SMS Receptionist

An AI-powered SMS triage bot for a local plumbing business. Customers text the Twilio number; Claude collects issue type, fixture, preferred time, and address; the owner receives an alert when the conversation is complete or urgent.

**Conversation state is Redis-backed (Upstash) with a 24-hour TTL.** State survives serverless cold starts and scales across multiple Vercel instances. An in-memory fallback is active only when the Redis env vars are absent — not suitable for production.

---

## SMS flow

1. Customer texts the Twilio number
2. Twilio POSTs to `/api/twilio/incoming-sms`
3. Claude generates a short reply (≤120 chars, ASCII-only)
4. Reply is sent back via Twilio
5. Owner receives an alert SMS when urgency is HIGH or booking info is complete
6. Interaction is logged to Google Sheets (optional)

## Missed-call text-back flow

1. Customer calls the Twilio number
2. Twilio POSTs to `/api/twilio/incoming-call`
3. Caller hears: "Sorry we missed your call. We just sent you a text." — call ends
4. Customer receives: "Hi, this is RapidFlow Plumbing. Sorry we missed your call. What can we help with?"
5. Any SMS reply re-enters the normal AI flow

---

## Stack

| Layer | Service |
|---|---|
| Hosting | Vercel (serverless) |
| AI | Anthropic Claude |
| SMS | Twilio Programmable Messaging |
| State | Upstash Redis REST (24-hour TTL per caller) |
| Log | Google Sheets (optional) |

---

## Local development

```bash
cp .env.example .env.local   # fill in real values (see table below)
npm install
npm run dev                  # http://localhost:3000
npm run test-sms             # unit + Claude API tests — no Twilio credits used
```

### Required env vars

| Variable | Where to find it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `TWILIO_ACCOUNT_SID` | [console.twilio.com](https://console.twilio.com) → Account Info |
| `TWILIO_AUTH_TOKEN` | Same page |
| `TWILIO_PHONE_NUMBER` | Twilio → Phone Numbers (E.164, e.g. `+12125551234`) |
| `OWNER_PHONE` | Your mobile number (E.164) — receives urgent alerts |
| `UPSTASH_REDIS_REST_URL` | [console.upstash.com](https://console.upstash.com) → your database → REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Same page → REST Token |
| `WEBHOOK_URL` | Your public URL for Twilio signature validation (set after deploy) |

### Optional env vars (Google Sheets logging)

| Variable | Notes |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google Cloud → IAM → Service Accounts |
| `GOOGLE_PRIVATE_KEY` | Service Account → Keys → JSON → `private_key` field |
| `GOOGLE_SHEET_ID` | From Sheet URL: `spreadsheets/d/<THIS>/edit` |

#### Google Sheets one-time setup

1. Create a Google Sheet with headers in row 1:
   `Timestamp | MessageSid | From | To | CustomerMessage | AIReply | OwnerNotified`
2. Share the sheet with your service account email (Editor access).

---

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
# Create repo on GitHub, then:
git remote add origin https://github.com/YOUR-USER/rapidflow-plumbing.git
git push -u origin main
```

### 2. Import into Vercel

1. Go to [vercel.com/new](https://vercel.com/new) → **Import Git Repository**.
2. Select `rapidflow-plumbing`. Framework preset: **Next.js** (auto-detected).
3. Click **Deploy** — the first build may fail if env vars are missing; that is expected.

### 3. Add environment variables

Vercel dashboard → **Settings → Environment Variables**.

Add every variable from the tables above. Set them for **Production** (and optionally Preview/Development).

For `WEBHOOK_URL`, you can set it after you know the Vercel domain (next step). Use a placeholder for now and update it after the first successful deploy.

### 4. Redeploy

After saving env vars: **Deployments → Redeploy** on the latest deployment. The build should succeed.

Your domain will look like `https://rapidflow-plumbing.vercel.app` (or a custom domain you configure).

### 5. Point Twilio webhooks at Vercel

**SMS webhook (incoming messages):**

1. Twilio Console → Phone Numbers → Manage → Active Numbers → your number.
2. **Messaging → A message comes in**:
   - Webhook: `https://YOUR-VERCEL-DOMAIN/api/twilio/incoming-sms`
   - Method: `HTTP POST`
3. Save.

**Voice webhook (missed-call text-back):**

1. Same phone number page → **Voice & Fax → A call comes in**:
   - Webhook: `https://YOUR-VERCEL-DOMAIN/api/twilio/incoming-call`
   - Method: `HTTP POST`
2. Save.

### 6. Update WEBHOOK_URL in Vercel

Back in Vercel env vars, set `WEBHOOK_URL` to the exact SMS webhook URL from step 5:

```
WEBHOOK_URL=https://YOUR-VERCEL-DOMAIN/api/twilio/incoming-sms
```

This must match the URL Twilio signs — any mismatch causes `403 Forbidden` on all incoming messages.

Redeploy once more after this update.

---

## Testing

```bash
# All unit tests + 5 Claude API scenarios (no Twilio, no Redis credits used)
npm run test-sms

# Test a specific message against Claude
npm run test-sms -- "my water heater is leaking"
```

---

## Architecture notes

| Topic | Detail |
|---|---|
| **State per caller** | Redis key `conv:{phone}`, 24-hour TTL, refreshed on every message |
| **MessageSid dedup** | Redis `SET dedup:{sid} NX EX 300` — Twilio retries are dropped in <1 ms |
| **Gas smell bypass** | Matches gas keywords → hardcoded life-safety reply, no Claude call |
| **Owner alert dedup** | `ownerAlertedHighUrgency` / `ownerAlertedComplete` flags in Redis state prevent re-alerting across restarts |
| **In-memory fallback** | Active when Redis env vars are absent; single-process only, not for production |

---

## Project structure

```
app/
  api/twilio/
    incoming-sms/route.ts   ← SMS webhook: slot collection, Claude reply, owner alert
    incoming-call/route.ts  ← Voice webhook: missed-call text-back
  layout.tsx
  page.tsx
lib/
  redis.ts                  ← Lazy Upstash Redis client (falls back to null if unconfigured)
  conversationState.ts      ← Async state functions backed by Redis; in-memory fallback
  anthropic.ts              ← Claude API integration
  twilio.ts                 ← SMS send + owner alert builder
  sanitize.ts               ← ASCII-only, ≤120 char enforcer
  slotExtractor.ts          ← Rule-based slot + urgency extractor
  prompt.ts                 ← Business system prompt per conversation stage
  googleSheets.ts           ← Optional Sheets logging
  classifyIntent.ts         ← Intent classifier
scripts/
  test-sms.ts               ← Full test suite (unit + Claude API, no Twilio required)
.env.example                ← All required vars with placeholder values
.gitignore
```
