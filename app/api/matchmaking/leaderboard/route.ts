import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

// Public route (no Admin check) that joins mm_players + profiles +
// vip_subscriptions into a single response, for the /matchmaking page.
// Uses the Service Role on the server instead of relying on the
// browser being able to read these tables with the anon key - this way
// it works regardless of the project's RLS state.
export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const [{ data: leaderboard }, { data: activeSeason }, { count: finishedMatches }, { data: vipSubs }] = await Promise.all([
    supabase.from("mm_players").select("*").order("elo", { ascending: false }).limit(25),
    supabase.from("mm_seasons").select("number, started_at").eq("is_active", true).maybeSingle(),
    supabase.from("mm_matches").select("*", { count: "exact", head: true }).eq("status", "finished"),
    supabase.from("vip_subscriptions").select("discord_id, tier, expires_at").eq("status", "active"),
  ]);

  const discordIds = (leaderboard ?? []).map((p) => p.discord_id).filter(Boolean);
  let profilesById = new Map<string, { discord_username: string | null; discord_global_name: string | null; avatar_url: string | null }>();

  if (discordIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("discord_id, discord_username, discord_global_name, avatar_url")
      .in("discord_id", discordIds);

    profilesById = new Map((profiles ?? []).map((p) => [String(p.discord_id), p]));
  }

  const vipByDiscordId = new Map((vipSubs ?? []).map((v) => [String(v.discord_id), v.tier]));

  const rows = (leaderboard ?? []).map((p) => {
    const profile = profilesById.get(String(p.discord_id));
    return {
      discord_id: p.discord_id,
      display_name: profile?.discord_global_name || profile?.discord_username || null,
      avatar_url: profile?.avatar_url ?? null,
      elo: p.elo,
      matches: p.matches,
      wins: p.wins,
      losses: p.losses,
      win_mvp: p.win_mvp,
      vip_tier: vipByDiscordId.get(String(p.discord_id)) ?? null,
    };
  });

  return NextResponse.json({
    leaderboard: rows,
    activeSeason: activeSeason ?? null,
    finishedMatches: finishedMatches ?? 0,
  });
}
