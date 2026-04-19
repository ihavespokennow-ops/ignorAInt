// send-campaign — Supabase Edge Function
// ---------------------------------------------------------------------------
// POST { campaign_id: uuid } with Authorization: Bearer <user JWT>.
// - Verifies the caller is a logged-in admin (via profiles.role).
// - Pulls the campaign's list of subscribed contacts.
// - Sends each one through Resend (batched, 10 at a time) from blog.ignoraint.com.
// - Records each attempt in campaign_sends.
// - Updates campaign.status to 'sending' -> 'sent' (or 'failed' on hard error).
// ---------------------------------------------------------------------------
//
// Required environment secrets (set via `supabase secrets set`):
//   RESEND_API_KEY          — from https://resend.com/api-keys
//   SUPABASE_URL            — auto-provided by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided by Supabase
//
// Optional:
//   DEFAULT_FROM_EMAIL      — e.g. addie@blog.ignoraint.com
//   DEFAULT_FROM_NAME       — e.g. "Addie Agarwal"
//   UNSUBSCRIBE_BASE_URL    — e.g. https://crm.ignoraint.com/unsubscribe
//   SENDER_POSTAL_ADDRESS   — CAN-SPAM footer; defaults to Ignoraint LLC
//   BATCH_SIZE              — 1..100 emails per Resend /emails/batch request (default 100)
//   BATCH_PACING_MS         — idle ms between batches (default 300)
//   MAX_BATCH_RETRIES       — 429 retries with exponential backoff (default 4)
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type Contact = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  unsubscribe_token: string;
};

type Campaign = {
  id: string;
  name: string;
  subject: string | null;
  preview_text: string | null;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  body_html: string | null;
  body_text: string | null;
  list_id: string | null;
  status: string;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Resend's Batch API accepts up to 100 emails per request. Using the batch
// endpoint keeps us at ~1 HTTP request per 100 contacts instead of 1 per email,
// so account-wide rate limits (5 req/s by default) become irrelevant.
const BATCH_SIZE             = Math.min(100, Number(Deno.env.get("BATCH_SIZE") ?? 100));
const BATCH_PACING_MS        = Number(Deno.env.get("BATCH_PACING_MS") ?? 300); // gap between batches
const MAX_BATCH_RETRIES      = Number(Deno.env.get("MAX_BATCH_RETRIES") ?? 4);
const UNSUBSCRIBE_BASE_URL   = Deno.env.get("UNSUBSCRIBE_BASE_URL") ?? "https://crm.ignoraint.com/unsubscribe";
// CAN-SPAM-required physical postal address, shown in every campaign footer.
// Override per-deploy with `supabase secrets set SENDER_POSTAL_ADDRESS="..."`.
const SENDER_POSTAL_ADDRESS = Deno.env.get("SENDER_POSTAL_ADDRESS") ?? "Ignoraint LLC · North Carolina, USA";

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

function personalize(template: string | null, contact: Contact, unsubUrl: string): string {
  if (!template) return "";
  const first = contact.first_name ?? "";
  const last  = contact.last_name ?? "";
  const full  = [first, last].filter(Boolean).join(" ");
  return template
    .replaceAll("{{first_name}}", first)
    .replaceAll("{{last_name}}",  last)
    .replaceAll("{{full_name}}",  full || contact.email)
    .replaceAll("{{email}}",      contact.email)
    .replaceAll("{{unsubscribe_url}}", unsubUrl);
}

function buildUnsubscribeUrl(contact: Contact): string {
  const u = new URL(UNSUBSCRIBE_BASE_URL);
  u.searchParams.set("c", contact.id);
  u.searchParams.set("t", contact.unsubscribe_token);
  return u.toString();
}

// Wraps body_html with a minimal-safe shell + footer if it looks like a fragment
function ensureHtmlShell(html: string, footerHtml: string): string {
  const hasShell = /<html[\s>]/i.test(html);
  if (hasShell) return html.replace(/<\/body>/i, `${footerHtml}</body>`);
  return `<!DOCTYPE html><html><body style="font-family: -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; line-height:1.55; color:#2A2A2A; background:#F5EFE6; padding:24px;">${html}${footerHtml}</body></html>`;
}

type EmailPayload = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  headers?: Record<string, string>;
};

// Single-email send — used only for the "send test" path so we get a clean
// single-message response.
async function resendSend(apiKey: string, payload: EmailPayload): Promise<{ id?: string; error?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) return { error: `${res.status}: ${text.slice(0, 500)}` };
  try { return { id: JSON.parse(text).id }; } catch { return {}; }
}

// Batch send — up to 100 emails in one HTTP request. Each item is a full
// email object (independent from, to, subject, html, headers), so we still
// get per-contact personalization, unsubscribe URL, etc. Retries on 429 with
// exponential backoff so a cold-cache rate-limit never marks real sends as
// "failed". Returns one result per input email, in order.
async function resendBatchSend(
  apiKey: string,
  payloads: EmailPayload[],
): Promise<Array<{ id?: string; error?: string }>> {
  if (payloads.length === 0) return [];

  let attempt = 0;
  while (attempt <= MAX_BATCH_RETRIES) {
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payloads),
    });
    const text = await res.text();

    // 429 → back off (1s, 2s, 4s, 8s, 16s) and retry the whole batch.
    if (res.status === 429 && attempt < MAX_BATCH_RETRIES) {
      const delay = Math.min(16000, 1000 * Math.pow(2, attempt));
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
      continue;
    }

    if (!res.ok) {
      const errMsg = `${res.status}: ${text.slice(0, 300)}`;
      return payloads.map(() => ({ error: errMsg }));
    }

    // Success — parse response. Resend returns { data: [{ id }, ...] } in order.
    try {
      const parsed = JSON.parse(text);
      const data: Array<{ id?: string }> = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
      return payloads.map((_, i) => ({ id: data[i]?.id }));
    } catch {
      return payloads.map(() => ({}));
    }
  }

  // Exhausted retries — still 429-ing.
  return payloads.map(() => ({ error: "Resend rate limit (429) after retries" }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey   = Deno.env.get("RESEND_API_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfigured: missing Supabase env" }, { status: 500 });
  if (!resendKey)                  return json({ error: "Server misconfigured: missing RESEND_API_KEY" }, { status: 500 });

  // --- authenticate caller ---
  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Unauthorized" }, { status: 401 });

  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: "Unauthorized" }, { status: 401 });

  // Admin role check via profiles
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: profile } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
  if (!profile || !["admin", "editor"].includes(profile.role)) {
    return json({ error: "Forbidden: admin/editor role required" }, { status: 403 });
  }

  // --- input ---
  let payload: { campaign_id?: string; test_email?: string; skip_already_sent?: boolean } = {};
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!payload.campaign_id) return json({ error: "campaign_id is required" }, { status: 400 });

  // --- load campaign ---
  const { data: campaign, error: cErr } = await admin
    .from("campaigns")
    .select("id, name, subject, preview_text, from_name, from_email, reply_to, body_html, body_text, list_id, status")
    .eq("id", payload.campaign_id).single<Campaign>();
  if (cErr || !campaign)      return json({ error: "Campaign not found" }, { status: 404 });
  if (!campaign.subject)      return json({ error: "Campaign is missing a subject" }, { status: 400 });
  if (!campaign.body_html && !campaign.body_text) return json({ error: "Campaign has no body" }, { status: 400 });
  if (!payload.test_email && !campaign.list_id)   return json({ error: "Campaign has no list_id" }, { status: 400 });
  if (!payload.test_email && campaign.status === "sent") return json({ error: "Campaign already sent" }, { status: 409 });

  // --- load recipients ---
  let contacts: Contact[] = [];
  if (payload.test_email) {
    contacts = [{ id: "00000000-0000-0000-0000-000000000000", email: payload.test_email, first_name: null, last_name: null, unsubscribe_token: "test" }];
  } else {
    const { data: lcs, error: lcErr } = await admin
      .from("list_contacts")
      .select("contact_id, contacts!inner(id, email, first_name, last_name, subscribed, unsubscribe_token)")
      .eq("list_id", campaign.list_id!)
      .eq("contacts.subscribed", true);
    if (lcErr) return json({ error: `Failed to load contacts: ${lcErr.message}` }, { status: 500 });
    // deno-lint-ignore no-explicit-any
    contacts = (lcs ?? []).map((r: any) => r.contacts);
  }

  if (contacts.length === 0) return json({ error: "No subscribed contacts in the list" }, { status: 400 });

  // Optional: filter out anyone who already received this campaign successfully.
  // This is what lets the user safely re-run a campaign that partially completed
  // (e.g., due to rate-limit errors) without double-emailing the people who got it.
  let skippedAlreadySent = 0;
  if (!payload.test_email && payload.skip_already_sent) {
    const { data: prior, error: prErr } = await admin
      .from("campaign_sends")
      .select("contact_id")
      .eq("campaign_id", campaign.id)
      .eq("status", "sent");
    if (prErr) return json({ error: `Failed to load prior sends: ${prErr.message}` }, { status: 500 });
    const alreadySent = new Set((prior ?? []).map((r: { contact_id: string }) => r.contact_id));
    const before = contacts.length;
    contacts = contacts.filter((c) => !alreadySent.has(c.id));
    skippedAlreadySent = before - contacts.length;
    if (contacts.length === 0) {
      return json({
        ok: true,
        campaign_id: campaign.id,
        sent: 0,
        failed: 0,
        skipped: skippedAlreadySent,
        total: 0,
        message: `All ${skippedAlreadySent} subscribed contact(s) on this list have already received this campaign — nothing to send.`,
      });
    }
  }

  // Mark campaign as sending
  if (!payload.test_email) {
    await admin.from("campaigns").update({ status: "sending" }).eq("id", campaign.id);
  }

  const results: { contact_id: string; email: string; status: string; error?: string; provider_message_id?: string }[] = [];
  const fromLine = `${campaign.from_name} <${campaign.from_email}>`;

  // Helper: turn a contact into a fully-personalized email payload (same shape
  // whether we're sending via /emails or /emails/batch).
  const buildPayload = (contact: Contact): EmailPayload => {
    const unsubUrl = buildUnsubscribeUrl(contact);
    const subject  = personalize(campaign.subject,   contact, unsubUrl);
    const bodyText = personalize(campaign.body_text, contact, unsubUrl);
    const footerH  = `<hr style="margin:32px 0 16px;border:0;border-top:1px solid #e0d9c5"/>
      <p style="color:#7a7367;font-size:12px;line-height:1.5;margin:0 0 8px">
        You're receiving this because you registered for an IgnorAInt masterclass.
        <a href="${unsubUrl}" style="color:#A8612F">Unsubscribe</a>.
      </p>
      <p style="color:#7a7367;font-size:12px;line-height:1.5;margin:0">
        ${SENDER_POSTAL_ADDRESS}
      </p>`;
    const footerT = `\n\n----\nYou're receiving this because you registered for an IgnorAInt masterclass.\nUnsubscribe: ${unsubUrl}\n${SENDER_POSTAL_ADDRESS}\n`;
    const html    = ensureHtmlShell(personalize(campaign.body_html, contact, unsubUrl), footerH);

    return {
      from: fromLine,
      to: contact.email,
      subject,
      html,
      text: `${bodyText}${footerT}`,
      reply_to: campaign.reply_to ?? undefined,
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };
  };

  // TEST SEND — one email, use the single-send endpoint for a clean response.
  if (payload.test_email) {
    const contact = contacts[0];
    const r = await resendSend(resendKey!, buildPayload(contact));
    results.push({
      contact_id: contact.id,
      email: contact.email,
      status: r.error ? "failed" : "sent",
      error: r.error,
      provider_message_id: r.id,
    });
  } else {
    // CAMPAIGN SEND — use /emails/batch (up to 100 emails per request).
    // This keeps us comfortably under Resend's 5 req/s account limit even at
    // 10,000+ recipients, and isolates rate-limit retries to whole batches.
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch    = contacts.slice(i, i + BATCH_SIZE);
      const payloads = batch.map(buildPayload);
      const batchRes = await resendBatchSend(resendKey!, payloads);

      // Record each result in campaign_sends. Upsert so re-sends don't error.
      for (let j = 0; j < batch.length; j++) {
        const contact = batch[j];
        const r       = batchRes[j] ?? {};
        const status  = r.error ? "failed" : "sent";
        await admin.from("campaign_sends").upsert({
          campaign_id: campaign.id,
          contact_id:  contact.id,
          status,
          provider_message_id: r.id ?? null,
          error:   r.error ?? null,
          sent_at: r.error ? null : new Date().toISOString(),
        }, { onConflict: "campaign_id,contact_id" });

        results.push({
          contact_id: contact.id,
          email: contact.email,
          status,
          error: r.error,
          provider_message_id: r.id,
        });
      }

      // Small gap between batches so we stay well under account-wide rate
      // limits (5 req/s). With batch size 100 this is ~200 emails/sec cap.
      if (i + BATCH_SIZE < contacts.length && BATCH_PACING_MS > 0) {
        await new Promise((r) => setTimeout(r, BATCH_PACING_MS));
      }
    }
  }

  const sent   = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;

  if (!payload.test_email) {
    await admin.from("campaigns").update({
      status: failed === contacts.length ? "failed" : "sent",
      sent_at: new Date().toISOString(),
    }).eq("id", campaign.id);
  }

  return json({ ok: true, campaign_id: campaign.id, sent, failed, skipped: skippedAlreadySent, total: contacts.length, results });
});
