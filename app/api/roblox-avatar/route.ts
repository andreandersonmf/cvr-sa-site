import { NextRequest, NextResponse } from "next/server";

async function resolveRobloxUserId(username: string) {
  const response = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      usernames: [username],
      excludeBannedUsers: false,
    }),
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  const id = data?.data?.[0]?.id;

  return id ? String(id) : null;
}

export async function GET(request: NextRequest) {
  let userId = request.nextUrl.searchParams.get("userId");
  const username = request.nextUrl.searchParams.get("username");

  if ((!userId || !/^\d+$/.test(userId)) && username) {
    userId = await resolveRobloxUserId(username.trim());
  }

  if (!userId || !/^\d+$/.test(userId)) {
    return NextResponse.json({ imageUrl: null }, { status: 200 });
  }

  try {
    const response = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return NextResponse.json({ imageUrl: null }, { status: 200 });
    }

    const data = await response.json();

    return NextResponse.json({
      userId,
      imageUrl: data?.data?.[0]?.imageUrl ?? null,
    });
  } catch {
    return NextResponse.json({ imageUrl: null }, { status: 200 });
  }
}