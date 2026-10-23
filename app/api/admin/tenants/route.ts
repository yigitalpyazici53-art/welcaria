import { NextRequest, NextResponse } from "next/server";
import { envOrUndefined } from "@/lib/env";
import { createTenant, listTenants } from "@/lib/tenants";

// Simple admin auth — compare against ADMIN_SECRET env var
function isAuthorized(req: NextRequest): boolean {
  const secret = envOrUndefined("ADMIN_SECRET");
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * GET /api/admin/tenants — list all tenants
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = await listTenants();
  return NextResponse.json({ tenants });
}

/**
 * POST /api/admin/tenants — create a new tenant (clinic)
 *
 * Body: { clinicName: string, contactEmail?: string, contactPhone?: string }
 * Returns the tenant with its onboarding link.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as {
    clinicName?: string;
    contactEmail?: string;
    contactPhone?: string;
  };

  if (!body.clinicName) {
    return NextResponse.json(
      { error: "clinicName is required" },
      { status: 400 }
    );
  }

  const tenant = await createTenant(
    body.clinicName,
    body.contactEmail,
    body.contactPhone
  );

  if (!tenant) {
    return NextResponse.json(
      { error: "Failed to create tenant" },
      { status: 500 }
    );
  }

  // Build the onboarding URL
  const baseUrl = envOrUndefined("NEXT_PUBLIC_BASE_URL") ?? "https://welcaria.com";
  const onboardingUrl = `${baseUrl}/connect?token=${tenant.onboarding_token}`;

  return NextResponse.json({
    tenant: {
      id: tenant.id,
      clinic_name: tenant.clinic_name,
      status: tenant.status,
      onboarding_token: tenant.onboarding_token,
    },
    onboardingUrl,
  });
}
