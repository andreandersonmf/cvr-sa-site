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

function cleanDiscordId(value: unknown) {
  const id = cleanText(value);
  return /^\d{5,25}$/.test(id) ? id : "";
}

function cleanUrl(value: unknown) {
  const text = cleanText(value);
  return text.startsWith("http://") || text.startsWith("https://") ? text : null;
}

async function getAuthUser(request: NextRequest) {
  if (!supabaseAdmin) throw new Error("Supabase service role is not configured.");

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export async function POST(request: NextRequest) {
  try {
    if (!supabaseAdmin) return jsonError("Supabase service role is not configured.", 500);

    const user = await getAuthUser(request);
    if (!user) return jsonError("Login with Discord is required.", 401);

    const body = await request.json().catch(() => ({}));
    const discordId = cleanDiscordId(body.discordId);
    const discordUsername = cleanDiscordUsername(body.discordUsername || body.username);
    const discordGlobalName = cleanText(body.discordGlobalName || body.globalName) || null;
    const avatarUrl = cleanUrl(body.avatarUrl) || null;
    const robloxUsername = cleanText(body.robloxUsername);
    const robloxUserId = cleanText(body.robloxUserId);

    if (!discordId && !discordUsername) {
      return jsonError("Discord identity was not detected.", 400);
    }

    const payload: Record<string, unknown> = {
      auth_user_id: user.id,
      discord_id: discordId || null,
      discord_username: discordUsername || null,
      discord_global_name: discordGlobalName,
      avatar_url: avatarUrl,
    };

    if (robloxUsername) payload.roblox_username = robloxUsername;
    if (robloxUserId) payload.roblox_user_id = robloxUserId;

    let byDiscord: any = null;
    let byAuth: any = null;

    if (discordId) {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("discord_id", discordId)
        .maybeSingle();
      if (error) return jsonError(error.message, 500);
      byDiscord = data ?? null;
    }

    const { data: authRow, error: authError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (authError) return jsonError(authError.message, 500);
    byAuth = authRow ?? null;

    let target = byDiscord ?? byAuth;

    if (byDiscord && byAuth && byDiscord.id !== byAuth.id) {
      // Keep the Discord-linked row as the canonical profile so old roster/transaction links still work.
      await supabaseAdmin
        .from("profiles")
        .update({ auth_user_id: null })
        .eq("id", byAuth.id);
      target = byDiscord;
    }

    let result: any = null;

    if (target?.id) {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .update(payload)
        .eq("id", target.id)
        .select("*")
        .maybeSingle();
      if (error) return jsonError(error.message, 500);
      result = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .insert(payload)
        .select("*")
        .maybeSingle();
      if (error) return jsonError(error.message, 500);
      result = data;
    }

    return NextResponse.json({ profile: result });
  } catch (error: any) {
    return jsonError(error?.message || "Unexpected profile sync error.", 500);
  }
}
