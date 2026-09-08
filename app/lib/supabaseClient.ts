import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Single shared instance for the whole app. Importing this file from every
// client component (instead of each page calling createClient() on its own)
// avoids the "Multiple GoTrueClient instances detected" warning and the
// session-sync issues it causes (e.g. session not showing up right after
// the Discord OAuth redirect).
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
