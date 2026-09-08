import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Client with the Service Role Key (bypasses RLS). Only for use in API
// routes (app/api/**) - never in code that runs in the browser. Same
// env var convention already used in profile-sync/team-sync/match-notify.
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!supabaseUrl || !serviceKey) return null;
  if (!cached) {
    cached = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
