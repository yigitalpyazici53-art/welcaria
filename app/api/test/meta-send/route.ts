import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppText, MetaWhatsAppError } from "@/lib/metaWhatsApp";

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

  if (!parsed.secret || parsed.secret !== configuredSecret) {
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

  // ── 3. Attempt send ───────────────────────────────────────────────────────
  try {
    await sendWhatsAppText(to, body);

    return NextResponse.json({
      ok: true,
      messageSent: true,
      diagnostics,
    });
  } catch (err) {
    if (err instanceof MetaWhatsAppError) {
      return NextResponse.json(
        {
          ok: false,
          messageSent: false,
          diagnostics,
          error: {
            message: err.message,
            status: err.status,
            metaError: err.metaError ?? null,
          },
        },
        { status: 502 }
      );
    }

    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        messageSent: false,
        diagnostics,
        error: { message, status: null, metaError: null },
      },
      { status: 500 }
    );
  }
}
