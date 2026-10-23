import { getSupabase } from "./supabase";
import { envOrUndefined } from "./env";
import crypto from "crypto";

// ── Types ───────────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  clinic_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  display_phone_number: string | null;
  access_token: string | null;
  meta_app_id: string | null;
  config: TenantConfig;
  status: "pending" | "active" | "suspended" | "disconnected";
  verified_at: string | null;
  onboarding_token: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantConfig {
  booking_url?: string;
  clinic_hours?: string;
  primary_service?: string;
  default_location?: string;
  owner_email?: string;
  owner_phone?: string;
  [key: string]: unknown;
}

// ── Cache ───────────────────────────────────────────────────────────────────────
// Phone number ID → tenant credentials, cached for 5 minutes to avoid DB hits
// on every webhook call.

interface CachedTenant {
  tenant: Tenant;
  cachedAt: number;
}

const tenantCache = new Map<string, CachedTenant>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(phoneNumberId: string): Tenant | null {
  const entry = tenantCache.get(phoneNumberId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    tenantCache.delete(phoneNumberId);
    return null;
  }
  return entry.tenant;
}

function setCache(phoneNumberId: string, tenant: Tenant): void {
  tenantCache.set(phoneNumberId, { tenant, cachedAt: Date.now() });
}

// ── Lookup ──────────────────────────────────────────────────────────────────────

/**
 * Find tenant by Meta phone_number_id (the ID that arrives in every webhook).
 * Falls back to env-var credentials for the legacy single-tenant setup.
 */
export async function getTenantByPhoneNumberId(
  phoneNumberId: string
): Promise<Tenant | null> {
  // Check cache first
  const cached = getCached(phoneNumberId);
  if (cached) return cached;

  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from("welcaria_tenants")
      .select("*")
      .eq("phone_number_id", phoneNumberId)
      .eq("status", "active")
      .single();

    if (!error && data) {
      const tenant = data as Tenant;
      setCache(phoneNumberId, tenant);
      return tenant;
    }
  }

  // Fallback: check if this matches the legacy env-var phone number ID
  const legacyPhoneNumberId = envOrUndefined("META_WHATSAPP_PHONE_NUMBER_ID");
  if (legacyPhoneNumberId && phoneNumberId === legacyPhoneNumberId) {
    const legacyTenant: Tenant = {
      id: "legacy",
      clinic_name: envOrUndefined("CLINIC_NAME") ?? "Default Clinic",
      contact_email: envOrUndefined("OWNER_EMAIL") ?? null,
      contact_phone: envOrUndefined("OWNER_PHONE") ?? null,
      waba_id: null,
      phone_number_id: legacyPhoneNumberId,
      display_phone_number: null,
      access_token: envOrUndefined("META_WHATSAPP_TOKEN") ?? null,
      meta_app_id: null,
      config: {},
      status: "active",
      verified_at: null,
      onboarding_token: null,
      onboarding_completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setCache(phoneNumberId, legacyTenant);
    return legacyTenant;
  }

  return null;
}

/**
 * Find tenant by onboarding token (used during Embedded Signup callback).
 */
export async function getTenantByOnboardingToken(
  token: string
): Promise<Tenant | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from("welcaria_tenants")
    .select("*")
    .eq("onboarding_token", token)
    .single();

  if (error || !data) return null;
  return data as Tenant;
}

// ── Create / Update ─────────────────────────────────────────────────────────────

/**
 * Create a new tenant (clinic). Generates a unique onboarding token.
 */
export async function createTenant(
  clinicName: string,
  contactEmail?: string,
  contactPhone?: string
): Promise<Tenant | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const onboardingToken = crypto.randomBytes(32).toString("hex");

  const { data, error } = await sb
    .from("welcaria_tenants")
    .insert({
      clinic_name: clinicName,
      contact_email: contactEmail ?? null,
      contact_phone: contactPhone ?? null,
      onboarding_token: onboardingToken,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    console.error("[Tenants] create failed:", error.message);
    return null;
  }
  return data as Tenant;
}

/**
 * Activate a tenant after successful Embedded Signup — stores WABA credentials.
 */
export async function activateTenant(
  tenantId: string,
  wabaId: string,
  phoneNumberId: string,
  displayPhoneNumber: string,
  accessToken: string
): Promise<Tenant | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from("welcaria_tenants")
    .update({
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      display_phone_number: displayPhoneNumber,
      access_token: accessToken,
      status: "active",
      verified_at: new Date().toISOString(),
      onboarding_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", tenantId)
    .select()
    .single();

  if (error) {
    console.error("[Tenants] activate failed:", error.message);
    return null;
  }

  const tenant = data as Tenant;
  // Cache the newly activated tenant
  if (tenant.phone_number_id) {
    setCache(tenant.phone_number_id, tenant);
  }
  return tenant;
}

/**
 * Update tenant config (booking URL, hours, etc.)
 */
export async function updateTenantConfig(
  tenantId: string,
  config: Partial<TenantConfig>
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;

  // Merge with existing config
  const { data: existing } = await sb
    .from("welcaria_tenants")
    .select("config")
    .eq("id", tenantId)
    .single();

  const merged = { ...(existing?.config ?? {}), ...config };

  const { error } = await sb
    .from("welcaria_tenants")
    .update({ config: merged, updated_at: new Date().toISOString() })
    .eq("id", tenantId);

  if (error) {
    console.error("[Tenants] config update failed:", error.message);
    return false;
  }

  // Invalidate cache for this tenant
  tenantCache.clear();
  return true;
}

/**
 * List all tenants (admin view).
 */
export async function listTenants(): Promise<Tenant[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from("welcaria_tenants")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[Tenants] list failed:", error.message);
    return [];
  }
  return (data ?? []) as Tenant[];
}
