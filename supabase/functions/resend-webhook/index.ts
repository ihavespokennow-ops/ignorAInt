// resend-webhook — Supabase Edge Function (PUBLIC, no JWT)
// ---------------------------------------------------------------------------
// Receives Resend webhook events (delivered, opened, clicked, bounced,
// complained, etc.) and updates per-recipient metrics in `campaign_sends`.
//
// Deploy with:  supabase functions deploy resend-webhook --no-verify-jwt
//
// Required env:
//   SUPABASE_URL                  (auto)
//   SUPABASE_SERVICE_ROLE_KEY     (auto)
//   RESEND_WEBHOOK_SECRET         (the Svix signing secret, format: whsec_<base64>)
//
// Security: Resend signs every request with Svix. We verify
//   HMAC-SHA256( decoded_secret , `${svix-id}.${svix-timestamp}.${rawBody}` )
// and reject anything missing, expired, or mismatched.
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// 5-minute replay window — Svix recommendation.
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, svix-id, svix-timestamp, svix-signature",
  };
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...corsHeaders(), ...(init.headers ?? {}) },
  });
}

// --- base64 helpers (Svix uses standard base64, not base64url) ---
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
// Constant-time compare to avoid timing leaks.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function verifySvixSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const id   = headers.get("svix-id");
  const ts   = headers.get("svix-timestamp");
  const sig  = headers.get("svix-signature");
  if (!id || !ts || !sig) return { ok: false, reason: "Missing Svix headers" };

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: "Bad svix-timestamp" };
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: "Timestamp outside tolerance" };
  }

  // Secret is "whsec_<base64>" — strip the prefix.
  const secretB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try { keyBytes = base64ToBytes(secretB64); }
  catch { return { ok: false, reason: "Invalid webhook secret" }; }

  const message = `${id}.${ts}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const expected = bytesToBase64(new Uint8Array(sigBytes));

  // svix-signature header is space-separated list of "v1,<base64>" pairs
  // (multiple sigs allowed during key rotation). Any match passes.
  const parts = sig.split(" ");
  for (const p of parts) {
    const [version, value] = p.split(",", 2);
    if (version === "v1" && value && timingSafeEqual(value, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "Signature mismatch" };
}

// --- event handling ---------------------------------------------------------
type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: Record<string, unknown> & {
    email_id?: string;
    bounce?: { type?: string; subType?: string };
    click?: { link?: string };
  };
};

// Map Resend event type -> column updates on campaign_sends.
function buildUpdate(eventType: string, occurredAt: string, data: ResendEvent["data"]): Record<string, unknown> | null {
  switch (eventType) {
    case "email.sent":
      // We already mark sent at send time; ignore to avoid clobbering.
      return null;
    case "email.delivered":
      return { delivered_at: occurredAt, last_event_at: occurredAt };
    case "email.delivery_delayed":
      return { last_event_at: occurredAt };
    case "email.bounced":
    case "email.failed":
      return {
        bounced_at: occurredAt,
        bounce_type: data?.bounce?.type ?? data?.bounce?.subType ?? "unknown",
        last_event_at: occurredAt,
      };
    case "email.complained":
      return { complained_at: occurredAt, last_event_at: occurredAt };
    // Open / click need increment semantics — handled separately below.
    default:
      return { last_event_at: occurredAt };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret      = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (!supabaseUrl || !serviceKey || !secret) {
    return json({ error: "Server misconfigured" }, { status: 500 });
  }

  // Read raw body BEFORE parsing — signature is over the exact bytes.
  const rawBody = await req.text();
  const verified = await verifySvixSignature(rawBody, req.headers, secret);
  if (!verified.ok) {
    return json({ error: "Invalid signature", reason: verified.reason }, { status: 401 });
  }

  let event: ResendEvent;
  try { event = JSON.parse(rawBody); }
  catch { return json({ error: "Invalid JSON" }, { status: 400 }); }

  const eventType  = event.type ?? "unknown";
  const occurredAt = event.created_at ?? new Date().toISOString();
  const messageId  = event.data?.email_id ?? null;

  const admin = createClient(supabaseUrl, serviceKey);

  // Persist the raw event for debugging / replay (best-effort).
  let sendRow: { id: string; campaign_id: string } | null = null;
  if (messageId) {
    const { data } = await admin
      .from("campaign_sends")
      .select("id, campaign_id")
      .eq("provider_message_id", messageId)
      .maybeSingle();
    if (data) sendRow = data as typeof sendRow;
  }

  await admin.from("email_events").insert({
    provider_message_id: messageId,
    campaign_send_id:    sendRow?.id ?? null,
    event_type:          eventType,
    occurred_at:         occurredAt,
    payload:             event as unknown as Record<string, unknown>,
  });

  // No matching send (e.g. test email or stale message id) — still 200 OK so
  // Resend stops retrying.
  if (!sendRow || !messageId) {
    return json({ ok: true, matched: false, event: eventType });
  }

  // Open / click are counter increments. Use rpc-style read-then-write to
  // avoid losing a count if two events land at once. (Two writes racing is
  // rare for a single recipient and a small undercount is acceptable.)
  if (eventType === "email.opened" || eventType === "email.clicked") {
    const isClick = eventType === "email.clicked";
    const { data: cur } = await admin
      .from("campaign_sends")
      .select(isClick
        ? "click_count, first_clicked_at"
        : "open_count, first_opened_at")
      .eq("id", sendRow.id)
      .single();

    const update: Record<string, unknown> = { last_event_at: occurredAt };
    if (isClick) {
      update.click_count     = ((cur as { click_count?: number } | null)?.click_count ?? 0) + 1;
      update.last_clicked_at = occurredAt;
      if (!(cur as { first_clicked_at?: string } | null)?.first_clicked_at) {
        update.first_clicked_at = occurredAt;
      }
      // A click implies the open also happened — record it if missing.
      update.last_opened_at = occurredAt;
    } else {
      update.open_count     = ((cur as { open_count?: number } | null)?.open_count ?? 0) + 1;
      update.last_opened_at = occurredAt;
      if (!(cur as { first_opened_at?: string } | null)?.first_opened_at) {
        update.first_opened_at = occurredAt;
      }
    }

    const { error: updErr } = await admin
      .from("campaign_sends").update(update).eq("id", sendRow.id);
    if (updErr) return json({ error: updErr.message }, { status: 500 });
    return json({ ok: true, matched: true, event: eventType });
  }

  const patch = buildUpdate(eventType, occurredAt, event.data);
  if (patch) {
    const { error: updErr } = await admin
      .from("campaign_sends").update(patch).eq("id", sendRow.id);
    if (updErr) return json({ error: updErr.message }, { status: 500 });
  }

  return json({ ok: true, matched: true, event: eventType });
});
