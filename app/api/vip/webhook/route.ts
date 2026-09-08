import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { assignDiscordRole } from "../../../../lib/discordServer";

export const runtime = "nodejs";

const VIP_DURATION_DAYS = 30;

type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

// VIP is a one-time Pix payment, not a Stripe Subscription and not Pix
// Automático - there is no recurring mandate and Stripe never charges
// anyone automatically. Every purchase simply grants VIP_DURATION_DAYS
// of access; once it expires the player has to come back and pay again
// from scratch (cogs/vip.py in the bot is what checks `expires_at` and
// removes the Discord role - this route never revokes it).
//
// Configure this in the Stripe Dashboard to listen for, pointing to
// <your site>/api/vip/webhook:
//   - checkout.session.completed
//   - checkout.session.async_payment_succeeded
//   - checkout.session.async_payment_failed
//   - checkout.session.expired
//
// Pix is an async payment method. When the customer finishes the
// Checkout Session (scans the QR code / opens the Pix copy-paste),
// `checkout.session.completed` fires immediately, but the money hasn't
// arrived yet - `payment_status` is still "unpaid" at that point. The
// real confirmation comes later as `checkout.session.async_payment_succeeded`.
// Granting VIP directly off `checkout.session.completed` regardless of
// `payment_status` would hand out VIP to people whose Pix later expires
// or fails.
export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature ?? "", webhookSecret);
  } catch (err) {
    console.error("[vip webhook] invalid signature:", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // Only grant VIP here if the money is already confirmed (covers
      // any instant payment method). For Pix this is normally still
      // "unpaid" - the actual grant happens on async_payment_succeeded
      // below.
      if (session.payment_status === "paid") {
        await grantVip(supabase, session);
      }
      break;
    }

    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      await grantVip(supabase, session);
      break;
    }

    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await markPendingPaymentAs(supabase, session, "failed");
      break;
    }

    case "checkout.session.expired": {
      // The customer opened the checkout (e.g. generated the Pix QR
      // code) but never actually paid before it expired.
      const session = event.data.object as Stripe.Checkout.Session;
      await markPendingPaymentAs(supabase, session, "expired");
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}

// Marks a still-pending vip_payments row as failed/expired so it stops
// showing up as an open payment. Never overwrites a row that already
// succeeded (shouldn't happen for these event types, but keeps this
// safe regardless of delivery order).
async function markPendingPaymentAs(supabase: SupabaseAdmin, session: Stripe.Checkout.Session, status: "failed" | "expired") {
  await supabase
    .from("vip_payments")
    .update({ status })
    .eq("provider_checkout_id", session.id)
    .eq("status", "pending");
}

async function grantVip(supabase: SupabaseAdmin, session: Stripe.Checkout.Session) {
  const discordId = session.metadata?.discordId;
  const tier = session.metadata?.tier as "vip" | "vip_plus" | undefined;

  if (!discordId || !tier) {
    console.error("[vip webhook] session missing expected metadata:", session.id);
    return;
  }

  // Idempotency: Stripe redelivers events (retries, duplicate
  // deliveries), and completed + async_payment_succeeded could both
  // reach here for the same session in an edge case. Don't grant a
  // second 30-day period or re-assign the Discord role for a checkout
  // that was already processed.
  const { data: existingPayment } = await supabase
    .from("vip_payments")
    .select("id, profile_id, status")
    .eq("provider_checkout_id", session.id)
    .maybeSingle();

  if (existingPayment?.status === "paid") return;

  const { data: payment } = await supabase
    .from("vip_payments")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      provider_payment_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
    })
    .eq("provider_checkout_id", session.id)
    .select("id, profile_id")
    .maybeSingle();

  // Any previous active subscription for this user is cancelled - an
  // upgrade/renewal swaps the plan instead of stacking two active ones.
  await supabase.from("vip_subscriptions").update({ status: "cancelled" }).eq("discord_id", discordId).eq("status", "active");

  const expiresAt = new Date(Date.now() + VIP_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await supabase.from("vip_subscriptions").insert({
    profile_id: payment?.profile_id ?? existingPayment?.profile_id ?? null,
    discord_id: discordId,
    tier,
    status: "active",
    source_payment_id: payment?.id ?? existingPayment?.id ?? null,
    expires_at: expiresAt,
    role_applied: false,
  });

  // Applies the VIP/VIP+ Discord role immediately. If it fails (bot
  // offline, role not configured, etc), cogs/vip.py in the bot does not
  // try to apply it again on its own - the `role_applied` field is kept
  // as a record for later manual audit/retry.
  const roleId = tier === "vip_plus" ? process.env.DISCORD_VIP_PLUS_ROLE_ID : process.env.DISCORD_VIP_ROLE_ID;
  if (roleId) {
    const applied = await assignDiscordRole(discordId, roleId);
    if (applied) {
      await supabase.from("vip_subscriptions").update({ role_applied: true }).eq("discord_id", discordId).eq("status", "active");
    }
  }
}
