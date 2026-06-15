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

## Internal production test endpoint

Simulate an inbound customer message without using Twilio SMS. Runs the full RandevuFlow pipeline and returns a JSON preview — **no SMS is sent, no Sheets row is written.**

**Endpoint:** `POST /api/test/inbound`

**Required env var:**

| Variable | Notes |
|---|---|
| `TEST_WEBHOOK_SECRET` | A long random string you choose. Set it in Vercel and locally in `.env.local`. |

> **Warning:** Keep `TEST_WEBHOOK_SECRET` private. Anyone who knows it can trigger pipeline logic and read conversation state on your production instance.

**Request body:**

```json
{
  "secret": "YOUR_TEST_WEBHOOK_SECRET",
  "from":   "+905551112233",
  "body":   "Merhaba lazer epilasyon fiyatı alabilir miyim?"
}
```

**curl example (production):**

```bash
curl -s -X POST https://YOUR-VERCEL-DOMAIN/api/test/inbound \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "YOUR_TEST_WEBHOOK_SECRET",
    "from":   "+905551112233",
    "body":   "Merhaba lazer epilasyon fiyatı alabilir miyim?"
  }' | jq .
```

**curl example (local dev server):**

```bash
curl -s -X POST http://localhost:3000/api/test/inbound \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "YOUR_TEST_WEBHOOK_SECRET",
    "from":   "+905551112233",
    "body":   "Merhaba lazer epilasyon fiyatı alabilir miyim?"
  }' | jq .
```

**Response shape:**

```json
{
  "ok": true,
  "from": "+905551112233",
  "input": "Merhaba lazer epilasyon fiyati alabilir miyim?",
  "intent": "price_question",
  "extractedSlots": { "service": "lazer epilasyon", "leadScore": "warm" },
  "stateBefore": { "stage": "collect_name", "history": [] },
  "stateAfter":  { "stage": "collect_name", "service": "lazer epilasyon", "history": [...] },
  "nextStage": "collect_name",
  "assistantReply": "Merhaba! Fiyat bilgisi icin ekibimiz sizinle iletisime gececektir. Adinizi ogrenebilir miyim?",
  "ownerAlertPreview": "[RF] +905551112233 WARM | lazer epilasyon | eksik: tarih+konum",
  "wouldNotifyOwner": true,
  "wouldLogToSheet": false
}
```

**Error responses:**

| Status | Meaning |
|---|---|
| `401` | Missing or wrong secret |
| `400` | Invalid JSON, or missing `from` / `body` fields |
| `500` | `TEST_WEBHOOK_SECRET` not set on the server |

**Local pipeline test (no server required):**

```bash
npm run test-inbound
```

---

## Resetting test conversation state

When testing the same WhatsApp or SMS number repeatedly, stale Redis state can cause unexpected behavior (e.g. the bot skips earlier stages because it already collected those slots). Use this endpoint to wipe the conversation state for a specific phone number before a fresh test run.

The endpoint deletes both the bare and `+`-prefixed key variants (`conv:<phone>` and `conv:+<phone>`) so it works regardless of how the number was stored.

**Endpoint:** `POST /api/test/reset`

**curl example (production):**

```bash
curl -X POST https://randevuflow.vercel.app/api/test/reset \
  -H "Content-Type: application/json" \
  -d '{"secret":"YOUR_TEST_WEBHOOK_SECRET","from":"905419473049"}'
```

Both formats are accepted — with or without the leading `+`:

```bash
-d '{"secret":"YOUR_TEST_WEBHOOK_SECRET","from":"+905419473049"}'
```

**Success response:**

```json
{
  "ok": true,
  "from": "905419473049",
  "deletedKeys": ["conv:905419473049", "conv:+905419473049"],
  "stateStorage": "redis"
}
```

**Error responses:**

| Status | Meaning |
|---|---|
| `401` | Missing or wrong secret |
| `400` | Invalid JSON, or missing `from` field |
| `500` | `TEST_WEBHOOK_SECRET` not set on the server, or Redis deletion failed |

**Local reset test (no server required):**

```bash
npm run test-reset
```

---

## Production state persistence

Vercel serverless functions are stateless — each request may land on a different instance with a fresh in-memory heap. Without Redis, multi-turn conversations lose their state between turns.

**Required env vars for multi-turn reliability:**

| Variable | Where to find it |
|---|---|
| `UPSTASH_REDIS_REST_URL` | [console.upstash.com](https://console.upstash.com) → your database → REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Same page → REST Token |

Without these, every request starts with an empty conversation state. The app logs `[State] Redis get failed` on each warm-start and falls back silently to in-memory storage.

**Diagnosing state storage mode:**

Call `POST /api/test/inbound` — the response includes:

```json
{
  "stateStorage": "redis",
  "statePersistenceWarning": null,
  "redisConfigured": true,
  "stateKey": "conv:+905551112233"
}
```

If `stateStorage` is `"memory"`, multi-turn state will not survive across serverless invocations:

```json
{
  "stateStorage": "memory",
  "statePersistenceWarning": "Redis is not configured; state will not persist reliably on serverless.",
  "redisConfigured": false
}
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

## Meta WhatsApp Cloud API Integration

Incoming WhatsApp messages are handled by the same RandevuFlow conversation pipeline as SMS. State is stored in Redis (Upstash) with the same 24-hour TTL, so multi-turn WhatsApp conversations persist across serverless invocations.

**Webhook URL:**

```
https://randevuflow.vercel.app/api/meta/whatsapp/webhook
```

### Required env vars

| Variable | Notes |
|---|---|
| `META_WEBHOOK_VERIFY_TOKEN` | A long random string you choose. Set it in Vercel and in Meta Developer Console → Webhook Verify Token. |
| `META_WHATSAPP_TOKEN` | Meta Developer Console → WhatsApp → API Setup → Temporary or Permanent Token |
| `META_WHATSAPP_PHONE_NUMBER_ID` | Meta Developer Console → WhatsApp → API Setup → Phone Number ID |
| `META_GRAPH_API_VERSION` | Graph API version (default: `v21.0`) |

> Redis (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) is required for multi-turn WhatsApp conversations to persist state between messages.

### Webhook behavior

**GET `/api/meta/whatsapp/webhook`** — Meta calls this to verify the webhook:
1. Meta sends `hub.mode=subscribe`, `hub.verify_token`, and `hub.challenge` as query params.
2. The route compares `hub.verify_token` with `META_WEBHOOK_VERIFY_TOKEN`.
3. If they match, returns `hub.challenge` as plain text with status 200.
4. Otherwise returns 403.

**POST `/api/meta/whatsapp/webhook`** — Meta sends incoming messages here:
1. The route parses the WhatsApp Business Account payload.
2. Status updates (delivery/read receipts) are acknowledged with `{ ok: true, processed: false, reason: "status_update" }` and ignored.
3. Non-text messages return `{ ok: true, processed: false, reason: "unsupported_message" }`.
4. Text messages are run through the shared RandevuFlow pipeline (`lib/inboundPipeline.ts`):
   - Load Redis conversation state for the sender's phone number
   - Classify intent, extract slots (name, service, date, time, location, phone)
   - Generate a Claude reply (or stage-based fallback if Anthropic is unavailable)
   - Update Redis state and history
5. The assistant reply is sent back to the customer via the Meta Graph API.
6. Returns `{ ok: true, processed: true, messageSent: true/false }`.

### Setting up in Meta Developer Console

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps** → create or select your app.
2. Add the **WhatsApp** product.
3. Under **WhatsApp → Configuration**:
   - **Callback URL:** `https://randevuflow.vercel.app/api/meta/whatsapp/webhook`
   - **Verify Token:** the value of `META_WEBHOOK_VERIFY_TOKEN` from your Vercel env vars
   - Click **Verify and Save**
4. Subscribe to the **messages** webhook field.
5. Under **WhatsApp → API Setup**, copy:
   - **Phone Number ID** → `META_WHATSAPP_PHONE_NUMBER_ID`
   - **Temporary access token** (or generate a permanent system-user token) → `META_WHATSAPP_TOKEN`
6. Add both to Vercel environment variables and redeploy.

### Local test (no HTTP server required)

```bash
npm run test-whatsapp
```

Runs the full 4-turn Turkish lead conversation through the shared pipeline and verifies:
- Slot extraction (service, date, time, name, phone, location)
- State persists across turns (Redis or in-memory fallback)
- `leadScore = hot` and `stage = complete` by turn 4
- `ownerAlertPreview` contains HOT + location + service

If `META_WHATSAPP_TOKEN` and `META_WHATSAPP_PHONE_NUMBER_ID` are configured, the test also sends real WhatsApp messages to the test phone numbers. Otherwise, sends are mocked (printed to console).

---

## Project structure

```
app/
  api/
    twilio/
      incoming-sms/route.ts          ← SMS webhook: slot collection, Claude reply, owner alert
      incoming-call/route.ts         ← Voice webhook: missed-call text-back
    meta/whatsapp/webhook/route.ts   ← WhatsApp webhook: GET verification + POST messages
    test/inbound/route.ts            ← Internal test endpoint (JSON, no SMS/WhatsApp sent)
    test/reset/route.ts              ← Test-only endpoint: clear Redis state by phone number
  layout.tsx
  page.tsx
lib/
  redis.ts                  ← Lazy Upstash Redis client (falls back to null if unconfigured)
  conversationState.ts      ← Async state functions backed by Redis; in-memory fallback
  inboundPipeline.ts        ← Shared pipeline: slot extraction → Claude reply → state update
  anthropic.ts              ← Claude API integration
  twilio.ts                 ← SMS send + owner alert builder
  metaWhatsApp.ts           ← Meta WhatsApp Cloud API message sender
  sanitize.ts               ← ASCII-only, ≤120 char enforcer
  slotExtractor.ts          ← Rule-based slot + urgency extractor
  prompt.ts                 ← Business system prompt per conversation stage
  googleSheets.ts           ← Optional Sheets logging
  classifyIntent.ts         ← Intent classifier
scripts/
  test-sms.ts               ← Full test suite (unit + Claude API, no Twilio required)
  test-inbound-endpoint.ts  ← Pipeline validation (no HTTP server required)
  test-whatsapp-webhook.ts  ← WhatsApp pipeline test: 4-turn lead → complete
  test-reset-endpoint.ts    ← Reset endpoint test: verifies state deletion + key normalization
.env.example                ← All required vars with placeholder values
.gitignore
```
