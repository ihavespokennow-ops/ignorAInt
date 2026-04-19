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
//   RATE_LIMIT_PER_SECOND   — Resend default is 10; leave unset unless raised.
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

const RATE_LIMIT_PER_SECOND = Number(Deno.env.get("RATE_LIMIT_PER_SECOND") ?? 10);
const UNSUBSCRIBE_BASE_URL  = Deno.env.get("UNSUBSCRIBE_BASE_URL") ?? "https://crm.ignoraint.com/unsubscribe";

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

async function resendSend(
  apiKey: string,
  payload: { from: string; to: string; subject: string; html: string; text: string; reply_to?: string; headers?: Record<string, string> }
): Promise<{ id?: string; error?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) return { error: `${res.status}: ${text.slice(0, 500)}` };
  try {
    const json = JSON.parse(text);
    return { id: json.id };
  } catch {
    return { id: undefined };
  }
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
  let payload: { campaign_id?: string; test_email?: string } = {};
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

  // Mark campaign as sending
  if (!payload.test_email) {
    await admin.from("campaigns").update({ status: "sending" }).eq("id", campaign.id);
  }

  const results: { contact_id: string; email: string; status: string; error?: string; provider_message_id?: string }[] = [];
  const fromLine = `${campaign.from_name} <${campaign.from_email}>`;

  // Send in small batches to respect provider rate limits.
  const batchSize = Math.max(1, RATE_LIMIT_PER_SECOND);
  for (let i = 0; i < contacts.length; i += batchSize) {
    const batch = contacts.slice(i, i + batchSize);
    const started = Date.now();

    const promises = batch.map(async (contact) => {
      const unsubUrl = buildUnsubscribeUrl(contact);
      const subject = personalize(campaign.subject, contact, unsubUrl);
      const text    = personalize(campaign.body_text, contact, unsubUrl);
      const footerH = `<hr style="margin:32px 0 16px;border:0;border-top:1px solid #e0d9c5"/>
        <p style="color:#7a7367;font-size:12px;line-height:1.5">
          You're receiving this because you registered for an IgnorAInt masterclass.
          <a href="${unsubUrl}" style="color:#A8612F">Unsubscribe</a>.
        </p>`;
      const html = ensureHtmlShell(personalize(campaign.body_html, contact, unsubUrl), footerH);

      const r = await resendSend(resendKey!, {
        from: fromLine,
        to: contact.email,
        subject,
        html,
        text,
        reply_to: campaign.reply_to ?? undefined,
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });

      const sendRow = {
        campaign_id: campaign.id,
        contact_id: contact.id,
        status: r.error ? "failed" : "sent",
        provider_message_id: r.id ?? null,
        error: r.error ?? null,
        sent_at: r.error ? null : new Date().toISOString(),
      };
      if (!payload.test_email) {
        await admin.from("campaign_sends")
          .upsert(sendRow, { onConflict: "campaign_id,contact_id" });
      }
      results.push({ contact_id: contact.id, email: contact.email, status: sendRow.status, error: r.error, provider_message_id: r.id });
    });

    await Promise.all(promises);

    // Pace: ensure batch takes at least ~1s to stay under RATE_LIMIT_PER_SECOND
    const elapsed = Date.now() - started;
    if (elapsed < 1000 && i + batchSize < contacts.length) {
      await new Promise((r) => setTimeout(r, 1000 - elapsed));
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

  return json({ ok: true, campaign_id: campaign.id, sent, failed, total: contacts.length, results });
});
