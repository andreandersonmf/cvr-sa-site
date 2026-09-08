import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type MatchStatus = "Scheduled" | "Live" | "Finished";

type MatchPayload = {
  id?: number | string;
  home_country?: string | null;
  away_country?: string | null;
  stage?: string | null;
  match_date?: string | null;
  match_time?: string | null;
  status?: MatchStatus | string | null;
  home_score?: number | null;
  away_score?: number | null;
  winner_country?: string | null;
  is_star_match?: boolean | null;
  set1_home?: number | null;
  set1_away?: number | null;
  set2_home?: number | null;
  set2_away?: number | null;
  set3_home?: number | null;
  set3_away?: number | null;
  set4_home?: number | null;
  set4_away?: number | null;
  set5_home?: number | null;
  set5_away?: number | null;
};

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const botToken = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || "";

const scheduleChannelId = process.env.MATCH_SCHEDULE_CHANNEL_ID || "1513976089729564743";
const streamAlertChannelId = process.env.STREAM_ALERT_CHANNEL_ID || "1483563002350407771";
const streamAlertRoleId = process.env.STREAM_ALERT_ROLE_ID || "1486907795101061170";
const resultsChannelId = process.env.MATCH_RESULTS_CHANNEL_ID || "1488057942925377608";

const supabaseAdmin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function formatDate(value?: string | null) {
  if (!value) return "TBA";
  const [year, month, day] = value.split("-");
  if (year && month && day) return `${day}/${month}/${year}`;
  return value;
}

function setLines(match: MatchPayload) {
  const sets = [
    [match.set1_home, match.set1_away],
    [match.set2_home, match.set2_away],
    [match.set3_home, match.set3_away],
    [match.set4_home, match.set4_away],
    [match.set5_home, match.set5_away],
  ];

  return sets
    .map(([home, away], index) => {
      if (home === null || home === undefined || away === null || away === undefined) return null;
      return `Set ${index + 1}: **${home} - ${away}**`;
    })
    .filter(Boolean)
    .join("\n") || "Sets not filled yet.";
}

function baseFields(match: MatchPayload) {
  return [
    { name: "Match", value: `**${match.home_country || "Home"}** vs **${match.away_country || "Away"}**`, inline: false },
    { name: "Stage", value: cleanText(match.stage) || "TBA", inline: true },
    { name: "Date", value: formatDate(match.match_date), inline: true },
    { name: "Time", value: `${cleanText(match.match_time) || "TBA"} BRT`, inline: true },
  ];
}

function buildEmbed(match: MatchPayload, eventType: MatchStatus) {
  const isStar = Boolean(match.is_star_match);
  const star = isStar ? " ⭐" : "";

  if (eventType === "Live") {
    return {
      title: `🔴 CVR SA MATCH LIVE${star}`,
      description: "The court is live now. Join the stream and support your team!",
      color: 0xef4444,
      fields: [
        ...baseFields(match),
        { name: "Status", value: "`LIVE NOW`", inline: false },
      ],
      footer: { text: "CVR South America • Stream Alert" },
      timestamp: new Date().toISOString(),
    };
  }

  if (eventType === "Finished") {
    const score = `${match.home_score ?? 0} - ${match.away_score ?? 0}`;
    return {
      title: `🏆 CVR SA MATCH RESULT${star}`,
      description: `**${match.home_country || "Home"}** ${score} **${match.away_country || "Away"}**`,
      color: 0xf59e0b,
      fields: [
        ...baseFields(match),
        { name: "Winner", value: match.winner_country ? `🏅 **${match.winner_country}**` : "No winner selected", inline: false },
        { name: "Set Scores", value: setLines(match), inline: false },
      ],
      footer: { text: "CVR South America • Final Result" },
      timestamp: new Date().toISOString(),
    };
  }

  return {
    title: `📅 CVR SA MATCH SCHEDULED${star}`,
    description: "A new match has been added to the official CVR SA schedule.",
    color: 0x10b981,
    fields: [
      ...baseFields(match),
      { name: "Status", value: "`SCHEDULED`", inline: false },
    ],
    footer: { text: "CVR South America • Match Schedule" },
    timestamp: new Date().toISOString(),
  };
}

async function assertAdmin(request: NextRequest) {
  if (!supabaseAdmin) throw new Error("Supabase service role is not configured.");
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return false;

  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  return roleRow?.role === "admin";
}

async function sendDiscordMessage(channelId: string, body: Record<string, unknown>) {
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN is not configured in Vercel.");
  if (!channelId) throw new Error("Discord channel ID is not configured.");

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord message failed (${response.status}): ${text || response.statusText}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!supabaseAdmin) return jsonError("Supabase service role is not configured.", 500);

    const isAdmin = await assertAdmin(request);
    if (!isAdmin) return jsonError("Only Admin can notify match channels.", 403);

    const body = await request.json().catch(() => ({}));
    const eventType = cleanText(body.eventType) as MatchStatus;
    const match = (body.match ?? {}) as MatchPayload;

    if (!["Scheduled", "Live", "Finished"].includes(eventType)) {
      return jsonError("Invalid match notification type.");
    }

    const channelId = eventType === "Live"
      ? streamAlertChannelId
      : eventType === "Finished"
        ? resultsChannelId
        : scheduleChannelId;

    const message: Record<string, unknown> = {
      embeds: [buildEmbed(match, eventType)],
    };

    if (eventType === "Live") {
      message.content = `<@&${streamAlertRoleId}> 🔴 **CVR SA match is LIVE:** ${match.home_country || "Home"} vs ${match.away_country || "Away"}`;
      message.allowed_mentions = { roles: [streamAlertRoleId] };
    }

    await sendDiscordMessage(channelId, message);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return jsonError(error?.message || "Unexpected match notify error.", 500);
  }
}
