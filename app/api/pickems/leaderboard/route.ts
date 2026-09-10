import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

// Public route (no Admin check) - same pattern as
// /api/matchmaking/leaderboard: uses the Service Role on the server so
// it works regardless of RLS, joins profiles in, and aggregates in JS.
//
// Defaults to the site's active season (league_settings.active_season_id).
// Pass ?season_id=<uuid> to view a specific past season instead.
export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const requestedSeasonId = request.nextUrl.searchParams.get("season_id");

  let seasonId = requestedSeasonId;
  if (!seasonId) {
    const { data: settings } = await supabase
      .from("league_settings")
      .select("active_season_id")
      .eq("id", 1)
      .maybeSingle();
    seasonId = (settings?.active_season_id as string | null) ?? null;
  }

  if (!seasonId) {
    return NextResponse.json({ leaderboard: [], seasonId: null });
  }

  const { data: predictions, error } = await supabase
    .from("pickems_predictions")
    .select("profile_id, points")
    .eq("season_id", seasonId)
    .not("points", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const totals = new Map<string, { totalPoints: number; predictionsScored: number }>();
  for (const row of predictions ?? []) {
    const key = String(row.profile_id);
    const current = totals.get(key) ?? { totalPoints: 0, predictionsScored: 0 };
    current.totalPoints += Number(row.points) || 0;
    current.predictionsScored += 1;
    totals.set(key, current);
  }

  const profileIds = Array.from(totals.keys());
  let profilesById = new Map<string, { discord_username: string | null; discord_global_name: string | null; avatar_url: string | null }>();

  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, discord_username, discord_global_name, avatar_url")
      .in("id", profileIds);

    profilesById = new Map((profiles ?? []).map((p) => [String(p.id), p]));
  }

  const rows = profileIds
    .map((profileId) => {
      const totalsForProfile = totals.get(profileId)!;
      const profile = profilesById.get(profileId);
      return {
        profile_id: profileId,
        display_name: profile?.discord_global_name || profile?.discord_username || null,
        avatar_url: profile?.avatar_url ?? null,
        total_points: totalsForProfile.totalPoints,
        predictions_scored: totalsForProfile.predictionsScored,
      };
    })
    .sort((a, b) => b.total_points - a.total_points || b.predictions_scored - a.predictions_scored)
    .slice(0, 50);

  return NextResponse.json({ leaderboard: rows, seasonId });
}
