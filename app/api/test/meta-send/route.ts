import { NextRequest, NextResponse } from "next/server";
import { sendOutbound } from "@/lib/outboundSend";
import { secretsMatch } from "@/lib/secretCompare";
import { isLocalDevelopment } from "@/lib/devGuard";

function maskToken(token: string | undefined): {
  hasToken: boolean;
  tokenLength: number;
  tokenPrefix: string;
  tokenSuffix: string;
} {
  if (!token) {
    return { hasToken: false, tokenLength: 0, tokenPrefix: "", tokenSuffix: "" };
  }
  return {
    hasToken: true,
    tokenLength: token.length,
    tokenPrefix: token.slice(0, 6),
    tokenSuffix: token.slice(-6),
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 0. Local development only (allow-list, fails closed) ──────────────────
  // Excluding only "production" left this live on preview deployments, which
  // normally carry production's Meta token — i.e. real sends to real patients,
  // plus the token prefix/suffix disclosed in the diagnostics block below.
  if (!isLocalDevelopment()) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  // ── 1. Validate secret ───────────────────────────────────────────────────
  const configuredSecret = process.env.TEST_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return NextResponse.json(
      { ok: false, error: "TEST_WEBHOOK_SECRET not configured on server" },
      { status: 500 }
    );
  }

  let parsed: { secret?: string; to?: string; body?: string };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!secretsMatch(parsed.secret, configuredSecret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const to = (parsed.to ?? "").trim();
  const body = (parsed.body ?? "").trim();

  if (!to) {
    return NextResponse.json({ ok: false, error: "Missing 'to'" }, { status: 400 });
  }
  if (!body) {
    return NextResponse.json({ ok: false, error: "Missing 'body'" }, { status: 400 });
  }

  // ── 2. Build diagnostics (no secrets exposed) ────────────────────────────
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.META_GRAPH_API_VERSION ?? "v21.0";
  const { hasToken, tokenLength, tokenPrefix, tokenSuffix } = maskToken(token);

  const diagnostics = {
    hasMetaToken: hasToken,
    metaTokenLength: tokenLength,
    metaTokenPrefix: tokenPrefix,
    metaTokenSuffix: tokenSuffix,
    hasPhoneNumberId: !!phoneNumberId,
    phoneNumberId: phoneNumberId ?? null,
    graphApiVersion: version,
    targetUrl: phoneNumberId
      ? `https://graph.facebook.com/${version}/${phoneNumberId}/messages`
      : null,
  };

  // ── 3. Attempt send — through the mandatory compliance gate ──────────────
  // Test sends obey the same rules as production sends: a number with no
  // inbound history or a closed 24h window is BLOCKED, never sent.
  const result = await sendOutbound({
    to,
    body,
    kind: "test",
    channel: "meta",
    threadKey: to,
  });

  if (result.sent) {
    return NextResponse.json({
      ok: true,
      messageSent: true,
      complianceDecision: result.decision,
      diagnostics,
    });
  }

  const blockedByGate = result.decision !== "ALLOWED";
  return NextResponse.json(
    {
      ok: false,
      messageSent: false,
      complianceDecision: result.decision,
      diagnostics,
      error: {
        message: blockedByGate
          ? `Blocked by compliance gate: ${result.decision}`
          : result.error ?? "transport send failed",
      },
    },
    { status: blockedByGate ? 403 : 502 }
  );
}
