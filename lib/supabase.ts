import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { envOrUndefined } from "./env";

let client: SupabaseClient | null = null;

/**
 * Server-side Supabase client (service role — full access, no RLS).
 * Returns null when credentials are not configured.
 */
export function getSupabase(): SupabaseClient | null {
  if (client) return client;

  const url = envOrUndefined("NEXT_PUBLIC_SUPABASE_URL");
  const key = envOrUndefined("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    console.warn("[Supabase] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
    return null;
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
