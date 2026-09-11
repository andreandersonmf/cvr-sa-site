import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";

// Matchmaking VIP/VIP+ prices, valid for 30 days. Keep this in sync
// with services/vip_data.py (VIP_PRICING) in the bot.
const VIP_PRICING: Record<"vip" | "vip_plus", { cents: number; label: string }> = {
  vip: { cents: 500, label: "R$ 5.00" },
  vip_plus: { cents: 1000, label: "R$ 10.00" },
};

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return jsonError("Payments are not configured yet (set STRIPE_SECRET_KEY in the site's .env).", 503);
  }

  const body = await request.json().catch(() => null);
  const tier = body?.tier as "vip" | "vip_plus" | undefined;
  const discordId = String(body?.discordId ?? "").trim();

  if (!tier || (tier !== "vip" && tier !== "vip_plus")) {
    return jsonError("Invalid tier.", 400);
  }
  if (!/^\d{5,25}$/.test(discordId)) {
    return jsonError("Invalid Discord ID.", 400);
  }

  const pricing = VIP_PRICING[tier];
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;

  try {
    // No payment_method_types here on purpose: Stripe shows whatever is
    // enabled in the Dashboard (Settings -> Payment methods) for this
    // currency/amount automatically ("dynamic payment methods"). That
    // way, when Pix gets approved on the account, it shows up with no
    // code change needed - and until then, Card/Apple Pay/Google
    // Pay/Link (already enabled) keep working instead of hard-failing
    // on every single checkout attempt.
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      currency: "brl",
      line_items: [
        {
          price_data: {
            currency: "brl",
            unit_amount: pricing.cents,
            product_data: {
              name: tier === "vip_plus" ? "NVL Matchmaking VIP+ (30 days)" : "NVL Matchmaking VIP (30 days)",
            },
          },
          quantity: 1,
        },
      ],
      metadata: { discordId, tier },
      success_url: `${siteUrl}/matchmaking?vip=success`,
      cancel_url: `${siteUrl}/matchmaking?vip=cancelled`,
    });

    const supabase = getSupabaseAdmin();
    if (supabase) {
      const { data: profile } = await supabase.from("profiles").select("id").eq("discord_id", discordId).maybeSingle();

      await supabase.from("vip_payments").insert({
        profile_id: profile?.id ?? null,
        discord_id: discordId,
        tier,
        amount_cents: pricing.cents,
        provider: "stripe",
        provider_checkout_id: session.id,
        checkout_url: session.url,
        status: "pending",
      });
    }

    return NextResponse.json({ checkoutUrl: session.url });
  } catch (error) {
    // Never let this bubble up unhandled - an unhandled throw here
    // becomes an HTML error page instead of JSON, which the client
    // can't parse and shows up as a generic "Connection error" on the
    // site with zero information about what actually went wrong.
    console.error("[vip/checkout] Stripe session creation failed:", error);
    const message =
      error instanceof Stripe.errors.StripeError
        ? error.message
        : "Could not start the payment. Please try again in a moment.";
    return jsonError(message, 502);
  }
}
