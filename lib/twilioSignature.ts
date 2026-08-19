import twilio from "twilio";
import type { NextRequest } from "next/server";

// ── Shared Twilio webhook authentication ──────────────────────────────────────
//
// Every Twilio-facing route validates X-Twilio-Signature through this helper.
//
// The default is ON, in every environment. It used to be gated on
// `NODE_ENV === "production"`, which is the wrong default twice over: a security
// control that defaults to off is one env var away from being absent in the
// place it matters, and any deployment that is not a Vercel production build
// (self-hosted, Docker, a dev server exposed through an ngrok tunnel) ran with
// no authentication at all — letting anyone forge an inbound message with an
// arbitrary `From`, write conversation state for a phone number they do not
// control, and make the clinic's Twilio account send SMS on demand.
//
// It can be turned off only by setting TWILIO_SIGNATURE_DISABLED=true, and only
// outside Vercel production. That escape hatch exists for local end-to-end
// testing; it announces itself loudly in the logs so a stray value cannot sit
// unnoticed in a deployed environment.

function signatureCheckDisabled(): boolean {
  if ((process.env.TWILIO_SIGNATURE_DISABLED ?? "").toLowerCase() !== "true") {
    return false;
  }
  // Never honour the kill switch on a production deployment.
  if (process.env.VERCEL_ENV === "production") {
    console.error(
      "[TwilioSig] TWILIO_SIGNATURE_DISABLED is set on a PRODUCTION deployment — ignoring it and validating anyway. Remove this env var."
    );
    return false;
  }
  return true;
}

/**
 * The absolute URL Twilio signed. Twilio computes the signature over the exact
 * URL configured in its console, so this must reproduce that string.
 *
 * `configuredUrl` is the per-route override (routes differ, so a single global
 * WEBHOOK_URL cannot serve all of them — pointing the voice or Nurabla route at
 * the SMS URL would fail every signature). Without an override the URL is rebuilt
 * from the forwarded proto/host headers, which is what the caller actually
 * requested; `req.url` is the last resort because a proxied request can carry an
 * internal host or scheme there.
 */
function urlForValidation(req: NextRequest, configuredUrl: string | undefined): string {
  if (configuredUrl) return configuredUrl;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return req.url;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const { pathname, search } = new URL(req.url);
  return `${proto}://${host}${pathname}${search}`;
}

/**
 * True when the request carries a valid Twilio signature. Fails CLOSED: a missing
 * auth token, a missing signature, or a thrown validation error all return false.
 */
export function isValidTwilioSignature(
  req: NextRequest,
  params: URLSearchParams,
  logPrefix: string,
  configuredUrl?: string
): boolean {
  if (signatureCheckDisabled()) {
    console.warn(
      `${logPrefix} SIGNATURE VALIDATION DISABLED via TWILIO_SIGNATURE_DISABLED — request accepted unverified. Never set this outside local testing.`
    );
    return true;
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error(`${logPrefix} TWILIO_AUTH_TOKEN not set — cannot verify signature, rejecting`);
    return false;
  }

  const signature = req.headers.get("x-twilio-signature") ?? "";
  const url = urlForValidation(req, configuredUrl);

  try {
    const paramsObj: Record<string, string> = {};
    for (const [key, value] of params.entries()) paramsObj[key] = value;

    const valid = twilio.validateRequest(authToken, signature, url, paramsObj);
    if (!valid) {
      console.warn(
        `${logPrefix} signature failed — url-used=${url} req-url=${req.url} sig-len=${signature.length}`
      );
      return false;
    }
    console.log(`${logPrefix} signature ok`);
    return true;
  } catch (err) {
    console.error(
      `${logPrefix} signature validation threw:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
