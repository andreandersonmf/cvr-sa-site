import { NextRequest, NextResponse } from "next/server";
import { getEffectiveAccess, extractBearerToken } from "../../../../lib/adminAccess";

export const runtime = "nodejs";

// Called by the client (admin/page.tsx and the home page) right after
// detecting an active Supabase session, to automatically find out
// whether that person is Owner / Admin / Stat Tracker / Referee /
// Media - without needing any separate password. See lib/adminAccess.ts
// for the rules.
export async function GET(request: NextRequest) {
  const token = extractBearerToken(request.headers.get("authorization"));
  const access = await getEffectiveAccess(token);
  return NextResponse.json(access);
}
