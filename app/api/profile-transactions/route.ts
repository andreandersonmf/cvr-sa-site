import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabaseAdmin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function cleanDiscordUsername(value: unknown) {
  return cleanText(value).replace(/^@/, "").replace(/#0$/, "");
}

function usernameVariants(value?: string | null) {
  const clean = cleanDiscordUsername(value);
  if (!clean) return [];
  return Array.from(new Set([clean, `${clean}#0`, `@${clean}`]));
}

async function getAuthContext(request: NextRequest) {
  if (!supabaseAdmin) throw new Error("Supabase service role is not configured.");

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);

  return { user: data.user, profile: profile ?? null };
}

async function findTeamById(teamId?: number | string | null) {
  if (!supabaseAdmin || !teamId) return null;
  const { data } = await supabaseAdmin
    .from("teams")
    .select("id,country,captain_name,captain_discord,captain_discord_id")
    .eq("id", teamId)
    .maybeSingle();
  return data ?? null;
}

async function findMembership(profile: any) {
  if (!supabaseAdmin || !profile) return null;

  const discordId = cleanText(profile.discord_id);
  const variants = usernameVariants(profile.discord_username);

  if (discordId) {
    const { data } = await supabaseAdmin
      .from("teams")
      .select("id,country,captain_name")
      .eq("captain_discord_id", discordId)
      .limit(1)
      .maybeSingle();

    if (data) {
      return {
        id: Number(data.id),
        team_id: Number(data.id),
        team_name: data.country ?? null,
        roblox_username: data.captain_name ?? null,
        role: "Captain",
        isCaptain: true,
        isManager: true,
      };
    }
  }

  if (variants.length > 0) {
    const { data } = await supabaseAdmin
      .from("teams")
      .select("id,country,captain_name")
      .in("captain_discord", variants)
      .limit(1)
      .maybeSingle();

    if (data) {
      return {
        id: Number(data.id),
        team_id: Number(data.id),
        team_name: data.country ?? null,
        roblox_username: data.captain_name ?? null,
        role: "Captain",
        isCaptain: true,
        isManager: true,
      };
    }
  }

  let player: any = null;

  if (discordId) {
    const { data } = await supabaseAdmin
      .from("team_players")
      .select("*")
      .eq("discord_id", discordId)
      .limit(1)
      .maybeSingle();
    if (data) player = data;
  }

  if (!player && variants.length > 0) {
    const { data } = await supabaseAdmin
      .from("team_players")
      .select("*")
      .in("discord_username", variants)
      .limit(1)
      .maybeSingle();
    if (data) player = data;
  }

  if (!player) return null;

  const team = await findTeamById(player.team_id);

  return {
    id: Number(player.id),
    team_id: Number(player.team_id),
    team_name: team?.country ?? null,
    roblox_username: player.roblox_username ?? null,
    role: player.role ?? "Player",
    isCaptain: false,
    isManager: player.role === "Vice Captain" || player.role === "Court Captain",
  };
}

function addFilter(filters: Set<string>, column: string, value?: string | number | null) {
  const clean = cleanText(value);
  if (!clean) return;
  filters.add(`${column}.eq.${clean}`);
}

export async function GET(request: NextRequest) {
  try {
    if (!supabaseAdmin) return jsonError("Supabase service role is not configured.", 500);

    const ctx = await getAuthContext(request);
    if (!ctx) return jsonError("Login with Discord is required.", 401);

    const profile = ctx.profile;
    if (!profile) {
      return NextResponse.json({ membership: null, transactions: [] });
    }

    const membership = await findMembership(profile);
    const filters = new Set<string>();
    const discordId = cleanText(profile.discord_id);

    addFilter(filters, "player_discord_id", discordId);
    addFilter(filters, "requester_discord_id", discordId);
    addFilter(filters, "handled_by_discord_id", discordId);

    for (const name of usernameVariants(profile.discord_username)) {
      addFilter(filters, "player_discord_username", name);
      addFilter(filters, "requester_discord_username", name);
      addFilter(filters, "handled_by_discord_username", name);
    }

    if (membership?.isManager && membership.team_id) {
      addFilter(filters, "team_id", membership.team_id);
    }

    if (filters.size === 0) {
      return NextResponse.json({ membership, transactions: [] });
    }

    const { data, error } = await supabaseAdmin
      .from("team_transactions")
      .select("*")
      .or(Array.from(filters).join(","))
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return jsonError(error.message, 500);

    return NextResponse.json({ membership, transactions: data ?? [] });
  } catch (error: any) {
    return jsonError(error?.message || "Unexpected profile transactions error.", 500);
  }
}
