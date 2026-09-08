import { getSupabaseAdmin } from "./supabaseAdmin";
import { isDiscordServerAdmin } from "./discordServer";

// Central authorization point for the site. This is ADDITIVE to the
// old admin/password login (which keeps working exactly as before,
// via the original `user_roles` table) - it never replaces it.
// Someone becomes a panel Admin if ANY of these is true:
//
//   1. It's the old fixed login (user_roles.role = 'admin' for the auth uid).
//   2. discord_id matches DISCORD_OWNER_ID (site's .env) -> Owner.
//   3. They have the "Administrator" permission on the Discord server
//      (checked via the bot token, requires DISCORD_GUILD_ID to be set).
//   4. They have an 'administrator' row in `site_user_roles` (granted
//      by another Admin in the panel's Users tab).
//
// Stat Tracker / Referee / Media follow the same pattern: Admin can
// always do everything; otherwise they depend on a matching row in
// `site_user_roles`.

export type EffectiveAccess = {
  authenticated: boolean;
  profileId: string | null;
  discordId: string | null;
  discordUsername: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  isStatTracker: boolean;
  isReferee: boolean;
  isMedia: boolean;
  roles: string[];
};

const NO_ACCESS: EffectiveAccess = {
  authenticated: false,
  profileId: null,
  discordId: null,
  discordUsername: null,
  avatarUrl: null,
  isOwner: false,
  isAdmin: false,
  isStatTracker: false,
  isReferee: false,
  isMedia: false,
  roles: [],
};

export function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

export async function getEffectiveAccess(token: string | null): Promise<EffectiveAccess> {
  const supabase = getSupabaseAdmin();
  if (!supabase || !token) return NO_ACCESS;

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return NO_ACCESS;

  const user = userData.user;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, discord_id, discord_username, avatar_url")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const { data: legacyRoleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const legacyIsAdmin = legacyRoleRow?.role === "admin";

  const discordId = profile?.discord_id ? String(profile.discord_id) : null;
  const ownerDiscordId = process.env.DISCORD_OWNER_ID || "";
  const isOwner = Boolean(ownerDiscordId) && discordId === ownerDiscordId;

  let siteRoles: string[] = [];
  if (profile?.id) {
    const { data: roleRows } = await supabase
      .from("site_user_roles")
      .select("role")
      .eq("profile_id", profile.id);
    siteRoles = (roleRows ?? []).map((r) => r.role as string);
  }

  const isServerAdmin = discordId ? await isDiscordServerAdmin(discordId) : false;

  const isAdmin = legacyIsAdmin || isOwner || isServerAdmin || siteRoles.includes("administrator");
  const isStatTracker = isAdmin || siteRoles.includes("stat_tracker");
  const isReferee = isAdmin || siteRoles.includes("referee");
  const isMedia = isAdmin || siteRoles.includes("media");

  return {
    authenticated: true,
    profileId: profile?.id ?? null,
    discordId,
    discordUsername: profile?.discord_username ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    isOwner,
    isAdmin,
    isStatTracker,
    isReferee,
    isMedia,
    roles: siteRoles,
  };
}
