import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type TeamPlayerRole = "Vice Captain" | "Court Captain" | "Player";

type TeamRow = {
  id: number;
  country: string;
  code?: string | null;
  captain_name?: string | null;
  captain_discord?: string | null;
  captain_discord_id?: string | null;
  captain_roblox_id?: string | null;
  discord_role_id?: string | null;
  season_id?: string | null;
};

type TeamPlayerRow = {
  id: number;
  team_id: number;
  discord_id?: string | null;
  discord_username?: string | null;
  roblox_username?: string | null;
  roblox_user_id?: string | null;
  role?: TeamPlayerRole | null;
  season_id?: string | null;
};

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const guildId = process.env.DISCORD_GUILD_ID || process.env.GUILD_ID || "";
const botToken = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || "";
const captainRoleId = process.env.DISCORD_CAPTAIN_ROLE_ID || process.env.CAPTAIN_ROLE_ID || "";
const viceCaptainRoleId = process.env.DISCORD_VICE_CAPTAIN_ROLE_ID || process.env.VICE_CAPTAIN_ROLE_ID || "";
// New for NVL: same permissions as Vice Captain everywhere. A team
// can have both a Vice Captain and a Court Captain at the same time.
const courtCaptainRoleId = process.env.DISCORD_COURT_CAPTAIN_ROLE_ID || process.env.COURT_CAPTAIN_ROLE_ID || "";
const playerRoleId = process.env.DISCORD_PLAYER_ROLE_ID || process.env.PLAYER_ROLE_ID || "";

// Discord role ID for a roster role, in addition to the team role.
function extraRoleIdFor(role: TeamPlayerRole | string | null | undefined): string {
  if (role === "Vice Captain") return viceCaptainRoleId;
  if (role === "Court Captain") return courtCaptainRoleId;
  return playerRoleId;
}

const supabaseAdmin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function cleanId(value: unknown) {
  const id = String(value ?? "").trim();
  return /^\d{5,25}$/.test(id) ? id : "";
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function cleanDiscordUsername(value: unknown) {
  return cleanText(value).replace(/^@/, "").replace(/#0$/, "");
}

async function getAuthContext(request: NextRequest) {
  if (!supabaseAdmin) throw new Error("Supabase service role is not configured.");

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();

  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    user: data.user,
    profile: profile ?? null,
    discordId: profile?.discord_id ? String(profile.discord_id) : null,
    discordUsername: profile?.discord_username ? String(profile.discord_username) : null,
    isAdmin: roleRow?.role === "admin",
  };
}

async function discordRole(method: "PUT" | "DELETE", userId: string, roleId?: string | null, reason?: string) {
  const safeUserId = cleanId(userId);
  const safeRoleId = cleanId(roleId);
  if (!botToken || !guildId || !safeUserId || !safeRoleId) return { skipped: true };

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${safeUserId}/roles/${safeRoleId}`,
    {
      method,
      headers: {
        Authorization: `Bot ${botToken}`,
        "X-Audit-Log-Reason": reason ? encodeURIComponent(reason.slice(0, 512)) : "NVL site sync",
      },
    },
  );

  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord role sync failed (${response.status}): ${text || response.statusText}`);
  }

  return { skipped: false };
}

async function addRoles(userId: string | null | undefined, roles: Array<string | null | undefined>, reason: string) {
  const safeUserId = cleanId(userId);
  if (!safeUserId) return;
  for (const roleId of roles) {
    if (cleanId(roleId)) await discordRole("PUT", safeUserId, roleId, reason);
  }
}

async function removeRoles(userId: string | null | undefined, roles: Array<string | null | undefined>, reason: string) {
  const safeUserId = cleanId(userId);
  if (!safeUserId) return;
  for (const roleId of roles) {
    if (cleanId(roleId)) await discordRole("DELETE", safeUserId, roleId, reason);
  }
}

async function getTeam(teamId: number): Promise<TeamRow | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.from("teams").select("*").eq("id", teamId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as TeamRow | null;
}

async function getRoster(teamId: number): Promise<TeamPlayerRow[]> {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin.from("team_players").select("*").eq("team_id", teamId);
  if (error) throw new Error(error.message);
  return (data ?? []) as TeamPlayerRow[];
}

async function recordTeamTransaction(payload: Record<string, any>) {
  if (!supabaseAdmin) return;

  const externalId = `site_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const { error } = await supabaseAdmin.from("team_transactions").insert({
    source: "site",
    external_source: "nvl_site",
    external_id: externalId,
    status: "accepted",
    handled_at: new Date().toISOString(),
    ...payload,
  });

  if (error) {
    console.warn("[team-sync] transaction log skipped:", error.message);
  }
}

async function findProfileByDiscordUsername(discordUsername?: string | null) {
  if (!supabaseAdmin || !discordUsername) return null;
  const clean = cleanDiscordUsername(discordUsername);
  if (!clean) return null;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .in("discord_username", [clean, `${clean}#0`])
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function resolveDiscordId(input: {
  discord_id?: string | null;
  discord_username?: string | null;
  roblox_user_id?: string | null;
}) {
  const direct = cleanId(input.discord_id);
  if (direct) return direct;

  const profile = await findProfileByDiscordUsername(input.discord_username);
  if (profile?.discord_id) return String(profile.discord_id);

  if (supabaseAdmin && input.roblox_user_id) {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("discord_id")
      .eq("roblox_user_id", String(input.roblox_user_id))
      .limit(1)
      .maybeSingle();
    if (data?.discord_id) return String(data.discord_id);
  }

  return "";
}

async function canManageTeam(ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>, team: TeamRow) {
  if (ctx.isAdmin) return true;
  if (!ctx.discordId) return false;
  if (String(team.captain_discord_id ?? "") === String(ctx.discordId)) return true;

  if (!supabaseAdmin) return false;
  const { data } = await supabaseAdmin
    .from("team_players")
    .select("id")
    .eq("team_id", team.id)
    .eq("discord_id", String(ctx.discordId))
    .in("role", ["Vice Captain", "Court Captain"])
    .limit(1);

  return Boolean(data && data.length > 0);
}

async function setTeamRole(ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>, body: any) {
  if (!ctx.isAdmin) return jsonError("Only Admin can set the Discord team role.", 403);
  if (!supabaseAdmin) return jsonError("Supabase service role is not configured.", 500);

  const teamId = Number(body.teamId);
  const discordRoleId = cleanId(body.discordRoleId);
  if (!teamId || !discordRoleId) return jsonError("Team ID and Discord role ID are required.");

  const { data, error } = await supabaseAdmin
    .from("teams")
    .update({ discord_role_id: discordRoleId })
    .eq("id", teamId)
    .select("*")
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  const team = data as TeamRow;

  if (team?.captain_discord_id) {
    await addRoles(team.captain_discord_id, [discordRoleId, captainRoleId], `NVL team role connected by ${ctx.discordUsername ?? ctx.user.email}`);
  }

  return NextResponse.json({ ok: true, team });
}

async function deleteTeam(ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>, body: any) {
  if (!ctx.isAdmin) return jsonError("Only Admin can delete teams.", 403);
  if (!supabaseAdmin) return jsonError("Supabase service role is not configured.", 500);

  const teamId = Number(body.teamId);
  if (!teamId) return jsonError("Team ID is required.");

  const team = await getTeam(teamId);
  if (!team) return jsonError("Team not found.", 404);

  const roster = await getRoster(teamId);
  const teamRoleId = team.discord_role_id;

  for (const player of roster) {
    const playerDiscordId = await resolveDiscordId(player);
    const extraRole = extraRoleIdFor(player.role);
    await removeRoles(playerDiscordId, [teamRoleId, extraRole], `NVL team deleted by ${ctx.discordUsername ?? ctx.user.email}`);
  }

  const captainDiscordId = await resolveDiscordId({
    discord_id: team.captain_discord_id,
    discord_username: team.captain_discord,
    roblox_user_id: team.captain_roblox_id,
  });
  await removeRoles(captainDiscordId, [teamRoleId, captainRoleId], `NVL team deleted by ${ctx.discordUsername ?? ctx.user.email}`);

  await supabaseAdmin.from("team_players").delete().eq("team_id", teamId);
  await supabaseAdmin.from("team_transactions").delete().eq("team_id", teamId);
  const { error } = await supabaseAdmin.from("teams").delete().eq("id", teamId);
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ ok: true });
}

async function changeCaptain(ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>, body: any) {
  if (!ctx.isAdmin) return jsonError("Only Admin can change captains.", 403);
  if (!supabaseAdmin) return jsonError("Supabase service role is not configured.", 500);

  const teamId = Number(body.teamId);
  const team = await getTeam(teamId);
  if (!team) return jsonError("Team not found.", 404);

  const newCaptain = {
    roblox_username: cleanText(body.captainName),
    roblox_user_id: cleanText(body.captainRobloxId),
    discord_username: cleanDiscordUsername(body.captainDiscord),
    discord_id: cleanId(body.captainDiscordId),
  };
  if (!newCaptain.roblox_username || !newCaptain.roblox_user_id || !newCaptain.discord_username) {
    return jsonError("New captain name, Discord username and Roblox ID are required.");
  }

  const newCaptainDiscordId = await resolveDiscordId(newCaptain);
  const oldCaptainDiscordId = await resolveDiscordId({
    discord_id: team.captain_discord_id,
    discord_username: team.captain_discord,
    roblox_user_id: team.captain_roblox_id,
  });

  const roster = await getRoster(teamId);
  const existingNewCaptainRoster = roster.find((player) =>
    (newCaptainDiscordId && String(player.discord_id ?? "") === newCaptainDiscordId) ||
    cleanDiscordUsername(player.discord_username) === newCaptain.discord_username ||
    String(player.roblox_user_id ?? "") === newCaptain.roblox_user_id,
  );

  if (existingNewCaptainRoster) {
    await supabaseAdmin.from("team_players").delete().eq("id", existingNewCaptainRoster.id);
  }

  const oldRole: TeamPlayerRole =
    body.oldCaptainNewRole === "Vice Captain" || body.oldCaptainNewRole === "Court Captain"
      ? body.oldCaptainNewRole
      : "Player";
  if (team.captain_name && team.captain_discord && String(team.captain_roblox_id ?? "").trim()) {
    await supabaseAdmin.from("team_players").insert({
      team_id: team.id,
      season_id: team.season_id ?? null,
      roblox_username: team.captain_name,
      roblox_user_id: String(team.captain_roblox_id),
      discord_username: cleanDiscordUsername(team.captain_discord),
      discord_id: oldCaptainDiscordId || team.captain_discord_id || null,
      role: oldRole,
    });
  }

  const { error } = await supabaseAdmin
    .from("teams")
    .update({
      captain_name: newCaptain.roblox_username,
      captain_discord: newCaptain.discord_username,
      captain_discord_id: newCaptainDiscordId || newCaptain.discord_id || null,
      captain_roblox_id: newCaptain.roblox_user_id,
    })
    .eq("id", team.id);
  if (error) return jsonError(error.message, 500);

  const teamRoleId = team.discord_role_id;
  await removeRoles(newCaptainDiscordId, [viceCaptainRoleId, playerRoleId], `NVL captain changed by ${ctx.discordUsername ?? ctx.user.email}`);
  await addRoles(newCaptainDiscordId, [teamRoleId, captainRoleId], `NVL captain changed by ${ctx.discordUsername ?? ctx.user.email}`);

  await removeRoles(oldCaptainDiscordId, [captainRoleId], `NVL captain changed by ${ctx.discordUsername ?? ctx.user.email}`);
  await addRoles(oldCaptainDiscordId, [teamRoleId, extraRoleIdFor(oldRole)], `NVL captain changed by ${ctx.discordUsername ?? ctx.user.email}`);

  await recordTeamTransaction({
    season_id: team.season_id ?? null,
    team_id: team.id,
    team_name: team.country,
    team_discord_role_id: team.discord_role_id ?? null,
    transaction_type: "captain_change",
    requested_role: "Captain",
    requester_discord_id: ctx.discordId,
    requester_discord_username: ctx.discordUsername ?? ctx.user.email,
    handled_by_discord_id: ctx.discordId,
    handled_by_discord_username: ctx.discordUsername ?? ctx.user.email,
    player_discord_id: newCaptainDiscordId || newCaptain.discord_id || null,
    player_discord_username: newCaptain.discord_username,
    roblox_username: newCaptain.roblox_username,
    roblox_user_id: newCaptain.roblox_user_id,
  });

  return NextResponse.json({ ok: true });
}

async function addPlayer(ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>, body: any) {
  if (!supabaseAdmin) return jsonError("Supabase service role is not configured.", 500);

  const teamId = Number(body.teamId);
  const team = await getTeam(teamId);
  if (!team) return jsonError("Team not found.", 404);
  if (!(await canManageTeam(ctx, team))) return jsonError("Only Admin, Captain, Vice Captain or Court Captain can add players.", 403);

  const role: TeamPlayerRole =
    body.role === "Vice Captain" || body.role === "Court Captain" ? body.role : "Player";
  const discordUsername = cleanDiscordUsername(body.discordUsername);
  const robloxUsername = cleanText(body.robloxUsername);
  const robloxUserId = cleanText(body.robloxUserId);
  const discordId = await resolveDiscordId({
    discord_id: body.discordId,
    discord_username: discordUsername,
    roblox_user_id: robloxUserId,
  });

  if (!discordUsername || !robloxUsername || !/^\d+$/.test(robloxUserId)) {
    return jsonError("Roblox username, numeric Roblox ID and Discord username are required.");
  }

  const { error } = await supabaseAdmin.from("team_players").insert({
    team_id: team.id,
    season_id: team.season_id ?? null,
    roblox_username: robloxUsername,
    roblox_user_id: robloxUserId,
    discord_username: discordUsername,
    discord_id: discordId || cleanId(body.discordId) || null,
    role,
  });
  if (error) return jsonError(error.message, 500);

  await addRoles(discordId || cleanId(body.discordId), [team.discord_role_id, extraRoleIdFor(role)], `NVL roster add by ${ctx.discordUsername ?? ctx.user.email}`);

  await recordTeamTransaction({
    season_id: team.season_id ?? null,
    team_id: team.id,
    team_name: team.country,
    team_discord_role_id: team.discord_role_id ?? null,
    transaction_type: "add_player",
    requested_role: role,
    requester_discord_id: ctx.discordId,
    requester_discord_username: ctx.discordUsername ?? ctx.user.email,
    handled_by_discord_id: ctx.discordId,
    handled_by_discord_username: ctx.discordUsername ?? ctx.user.email,
    player_discord_id: discordId || cleanId(body.discordId) || null,
    player_discord_username: discordUsername,
    roblox_username: robloxUsername,
    roblox_user_id: robloxUserId,
  });

  return NextResponse.json({ ok: true });
}

async function removePlayer(ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>, body: any) {
  if (!supabaseAdmin) return jsonError("Supabase service role is not configured.", 500);

  const playerId = Number(body.playerId);
  if (!playerId) return jsonError("Player ID is required.");

  const { data: player, error: playerError } = await supabaseAdmin.from("team_players").select("*").eq("id", playerId).maybeSingle();
  if (playerError) return jsonError(playerError.message, 500);
  if (!player) return jsonError("Player not found.", 404);

  const team = await getTeam(Number(player.team_id));
  if (!team) return jsonError("Team not found.", 404);
  if (!(await canManageTeam(ctx, team))) return jsonError("Only Admin, Captain, Vice Captain or Court Captain can remove players.", 403);

  const playerDiscordId = await resolveDiscordId(player as TeamPlayerRow);
  const extraRole = extraRoleIdFor(player.role);
  await removeRoles(playerDiscordId, [team.discord_role_id, extraRole], `NVL roster remove by ${ctx.discordUsername ?? ctx.user.email}`);

  const { error } = await supabaseAdmin.from("team_players").delete().eq("id", playerId);
  if (error) return jsonError(error.message, 500);

  await recordTeamTransaction({
    season_id: team.season_id ?? null,
    team_id: team.id,
    team_name: team.country,
    team_discord_role_id: team.discord_role_id ?? null,
    transaction_type: "remove_player",
    requested_role: player.role ?? null,
    requester_discord_id: ctx.discordId,
    requester_discord_username: ctx.discordUsername ?? ctx.user.email,
    handled_by_discord_id: ctx.discordId,
    handled_by_discord_username: ctx.discordUsername ?? ctx.user.email,
    player_discord_id: playerDiscordId || player.discord_id || null,
    player_discord_username: player.discord_username ?? null,
    roblox_username: player.roblox_username ?? null,
    roblox_user_id: player.roblox_user_id ?? null,
  });

  return NextResponse.json({ ok: true });
}

async function leaveTeam(ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>) {
  if (!supabaseAdmin) return jsonError("Supabase service role is not configured.", 500);
  if (!ctx.discordId) return jsonError("Discord login is required.", 403);

  const { data: captainTeam } = await supabaseAdmin.from("teams").select("*").eq("captain_discord_id", ctx.discordId).limit(1).maybeSingle();
  if (captainTeam) return jsonError("Captains cannot leave from Profile. Ask an Admin to change captain or delete the team.", 403);

  let playerQuery = await supabaseAdmin.from("team_players").select("*").eq("discord_id", ctx.discordId).limit(1).maybeSingle();
  let player = playerQuery.data as TeamPlayerRow | null;

  if (!player && ctx.discordUsername) {
    const fallback = await supabaseAdmin
      .from("team_players")
      .select("*")
      .ilike("discord_username", ctx.discordUsername)
      .limit(1)
      .maybeSingle();
    player = fallback.data as TeamPlayerRow | null;
  }

  if (!player) return jsonError("You are not registered in a team roster.", 404);

  const team = await getTeam(Number(player.team_id));
  if (!team) return jsonError("Team not found.", 404);

  const extraRole = extraRoleIdFor(player.role);
  await removeRoles(ctx.discordId, [team.discord_role_id, extraRole], "NVL profile leave team");

  const { error } = await supabaseAdmin.from("team_players").delete().eq("id", player.id);
  if (error) return jsonError(error.message, 500);

  await recordTeamTransaction({
    season_id: team.season_id ?? null,
    team_id: team.id,
    team_name: team.country,
    team_discord_role_id: team.discord_role_id ?? null,
    transaction_type: "leave_team",
    requested_role: player.role ?? null,
    requester_discord_id: ctx.discordId,
    requester_discord_username: ctx.discordUsername ?? ctx.user.email,
    handled_by_discord_id: ctx.discordId,
    handled_by_discord_username: ctx.discordUsername ?? ctx.user.email,
    player_discord_id: ctx.discordId,
    player_discord_username: ctx.discordUsername ?? null,
    roblox_username: player.roblox_username ?? null,
    roblox_user_id: player.roblox_user_id ?? null,
  });

  return NextResponse.json({ ok: true, team: team.country });
}


async function listPendingTransfers(ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>) {
  if (!ctx.isAdmin) return jsonError("Only Admin can list pending transfers.", 403);
  if (!supabaseAdmin) return jsonError("Supabase service role is not configured.", 500);

  const { data, error } = await supabaseAdmin
    .from("team_transactions")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ ok: true, transactions: data ?? [] });
}

async function clearTransfer(ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>, body: any) {
  if (!ctx.isAdmin) return jsonError("Only Admin can clear transfers.", 403);
  if (!supabaseAdmin) return jsonError("Supabase service role is not configured.", 500);

  const transactionId = cleanText(body.transactionId);
  const playerDiscordId = cleanId(body.playerDiscordId);

  let query = supabaseAdmin.from("team_transactions").delete().eq("status", "pending");
  if (transactionId) query = query.eq("id", transactionId);
  else if (playerDiscordId) query = query.eq("player_discord_id", playerDiscordId);
  else return jsonError("Transaction ID or player Discord ID is required.");

  const { error } = await query;
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  try {
    if (!supabaseAdmin) return jsonError("Supabase service role is not configured.", 500);

    const ctx = await getAuthContext(request);
    if (!ctx) return jsonError("Login with Discord/Supabase is required.", 401);

    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "set_team_role") return await setTeamRole(ctx, body);
    if (action === "delete_team") return await deleteTeam(ctx, body);
    if (action === "change_captain") return await changeCaptain(ctx, body);
    if (action === "add_player") return await addPlayer(ctx, body);
    if (action === "remove_player") return await removePlayer(ctx, body);
    if (action === "leave_team") return await leaveTeam(ctx);
    if (action === "clear_transfer") return await clearTransfer(ctx, body);
    if (action === "list_pending_transfers") return await listPendingTransfers(ctx);

    return jsonError("Unknown team sync action.");
  } catch (error: any) {
    return jsonError(error?.message || "Unexpected team sync error.", 500);
  }
}
