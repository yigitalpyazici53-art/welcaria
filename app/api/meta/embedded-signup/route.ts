import { NextRequest, NextResponse } from "next/server";
import { envOrUndefined } from "@/lib/env";
import {
  getTenantByOnboardingToken,
  activateTenant,
} from "@/lib/tenants";

/**
 * POST /api/meta/embedded-signup
 *
 * Called from the client after a successful Meta Embedded Signup flow.
 * Receives the short-lived code from Facebook Login, exchanges it for a
 * long-lived System User Access Token, fetches the WABA details, and
 * activates the tenant.
 *
 * Body: { code: string, onboardingToken: string }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as {
      code?: string;
      onboardingToken?: string;
    };

    const { code, onboardingToken } = body;

    if (!code || !onboardingToken) {
      return NextResponse.json(
        { error: "Missing code or onboardingToken" },
        { status: 400 }
      );
    }

    // 1. Verify the onboarding token belongs to a pending tenant
    const tenant = await getTenantByOnboardingToken(onboardingToken);
    if (!tenant) {
      return NextResponse.json(
        { error: "Invalid onboarding token" },
        { status: 404 }
      );
    }

    if (tenant.status === "active") {
      return NextResponse.json(
        { error: "This clinic is already connected", tenantId: tenant.id },
        { status: 409 }
      );
    }

    const appId = envOrUndefined("META_APP_ID");
    const appSecret = envOrUndefined("META_WHATSAPP_APP_SECRET");

    if (!appId || !appSecret) {
      console.error("[EmbeddedSignup] META_APP_ID or META_WHATSAPP_APP_SECRET not configured");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // 2. Exchange code for short-lived user token
    const tokenUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("code", code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = await tokenRes.json() as {
      access_token?: string;
      error?: { message: string };
    };

    if (!tokenData.access_token) {
      console.error("[EmbeddedSignup] Token exchange failed:", tokenData.error?.message);
      return NextResponse.json(
        { error: "Failed to exchange code for token", detail: tokenData.error?.message },
        { status: 400 }
      );
    }

    const userToken = tokenData.access_token;

    // 3. Get shared WABA list — the WABAs the user granted us access to
    const sharedWabaRes = await fetch(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${userToken}`,
      { headers: { Authorization: `Bearer ${appId}|${appSecret}` } }
    );
    const debugData = await sharedWabaRes.json() as {
      data?: {
        granular_scopes?: Array<{
          scope: string;
          target_ids?: string[];
        }>;
      };
    };

    // Find the WABA ID from the granted scopes
    const wabaScope = debugData.data?.granular_scopes?.find(
      (s) => s.scope === "whatsapp_business_management"
    );
    const wabaId = wabaScope?.target_ids?.[0];

    if (!wabaId) {
      console.error("[EmbeddedSignup] No WABA found in granted scopes:", JSON.stringify(debugData));
      return NextResponse.json(
        { error: "No WhatsApp Business Account was shared. Please try again and grant access." },
        { status: 400 }
      );
    }

    // 4. Subscribe the WABA to our app (so we receive webhooks)
    await fetch(
      `https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${userToken}` },
      }
    );

    // 5. Get phone numbers for this WABA
    const phoneRes = await fetch(
      `https://graph.facebook.com/v21.0/${wabaId}/phone_numbers`,
      { headers: { Authorization: `Bearer ${userToken}` } }
    );
    const phoneData = await phoneRes.json() as {
      data?: Array<{
        id: string;
        display_phone_number: string;
        verified_name: string;
      }>;
    };

    const phone = phoneData.data?.[0];
    if (!phone) {
      console.error("[EmbeddedSignup] No phone numbers found for WABA:", wabaId);
      return NextResponse.json(
        { error: "No phone number found on this WhatsApp Business Account." },
        { status: 400 }
      );
    }

    // 6. Register the phone number for Cloud API (in case it isn't already)
    await fetch(
      `https://graph.facebook.com/v21.0/${phone.id}/register`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          pin: "123456", // Required but arbitrary for Cloud API
        }),
      }
    );

    // 7. Activate the tenant in our DB
    const activated = await activateTenant(
      tenant.id,
      wabaId,
      phone.id,
      phone.display_phone_number,
      userToken
    );

    if (!activated) {
      return NextResponse.json(
        { error: "Failed to save credentials" },
        { status: 500 }
      );
    }

    console.log(
      `[EmbeddedSignup] Tenant ${tenant.clinic_name} activated — WABA=${wabaId} phone=${phone.display_phone_number}`
    );

    return NextResponse.json({
      success: true,
      clinic: tenant.clinic_name,
      phone: phone.display_phone_number,
      verifiedName: phone.verified_name,
    });
  } catch (err) {
    console.error(
      "[EmbeddedSignup] Unexpected error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
