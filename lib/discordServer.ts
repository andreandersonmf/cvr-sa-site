// Server-side helpers that talk to the Discord API using the bot
// token (NEVER import this in code that runs in the browser). Used to:
//  - check whether a user has the "Administrator" permission on the
//    server (this makes them an Admin on the panel automatically,
//    with no row needed in `site_user_roles`);
//  - apply/remove the VIP / VIP+ role when a payment is confirmed or
//    expires.
//
// Follows the same environment variable convention already used in
// app/api/team-sync/route.ts (accepts both names for compatibility).

const DISCORD_API = "https://discord.com/api/v10";
const ADMINISTRATOR_BIT = BigInt(0x8);

const guildId = process.env.DISCORD_GUILD_ID || process.env.GUILD_ID || "";
const botToken = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || "";

type DiscordRole = { id: string; permissions: string };
type DiscordGuildMember = { user?: { id: string }; roles: string[] };

async function discordFetch(path: string) {
  if (!botToken) return null;

  const res = await fetch(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: "no-store",
  });

  if (!res.ok) return null;
  return res.json();
}

// true if the user (by discord_id) has the Administrator permission on
// the server configured in DISCORD_GUILD_ID. Combines the @everyone
// role with all of the member's roles, the same way Discord itself
// computes permissions.
export async function isDiscordServerAdmin(discordId: string | null | undefined): Promise<boolean> {
  if (!discordId || !guildId || !botToken) return false;

  const member: DiscordGuildMember | null = await discordFetch(`/guilds/${guildId}/members/${discordId}`);
  if (!member) return false;

  const roles: DiscordRole[] | null = await discordFetch(`/guilds/${guildId}/roles`);
  if (!roles) return false;

  const everyoneRole = roles.find((r) => r.id === guildId);
  let permissions = everyoneRole ? BigInt(everyoneRole.permissions) : BigInt(0);

  for (const roleId of member.roles) {
    const role = roles.find((r) => r.id === roleId);
    if (role) permissions |= BigInt(role.permissions);
  }

  return (permissions & ADMINISTRATOR_BIT) === ADMINISTRATOR_BIT;
}

export async function assignDiscordRole(discordId: string, roleId: string): Promise<boolean> {
  if (!guildId || !botToken || !discordId || !roleId) return false;

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discordId}/roles/${roleId}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${botToken}` },
  });

  return res.ok || res.status === 404;
}

export async function removeDiscordRole(discordId: string, roleId: string): Promise<boolean> {
  if (!guildId || !botToken || !discordId || !roleId) return false;

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discordId}/roles/${roleId}`, {
    method: "DELETE",
    headers: { Authorization: `Bot ${botToken}` },
  });

  return res.ok || res.status === 404;
}
