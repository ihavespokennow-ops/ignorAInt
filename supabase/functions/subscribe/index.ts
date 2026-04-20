// subscribe — PUBLIC Supabase Edge Function
// ---------------------------------------------------------------------------
// Newsletter signup for ignoraint.com and /blog. Takes an email (plus an
// optional first_name), upserts the contact, adds them to a named list
// (default: "Blog Subscribers"), and fires a short branded welcome via
// Resend. Cheap, idempotent — re-subscribing the same email is a no-op.
//
// Deploy:  supabase functions deploy subscribe --no-verify-jwt
//
// Required env:
//   SUPABASE_URL                    (auto)
//   SUPABASE_SERVICE_ROLE_KEY       (auto)
//   RESEND_API_KEY                  (already set — reused)
//   SENDER_FROM                     e.g. "Addie Agarwal <addie@blog.ignoraint.com>"
//   SENDER_POSTAL_ADDRESS           (already set — reused for footer)
//
// Optional env:
//   SUBSCRIBE_LIST_NAME             Defaults to "Blog Subscribers". Created
//                                   automatically if missing.
//   ALLOWED_ORIGINS                 Comma-separated CORS allowlist.
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ----- CORS ------------------------------------------------------------------
function corsHeaders(origin: string | null) {
  const allow = (Deno.env.get("ALLOWED_ORIGINS") ??
    "https://ignoraint.com,https://www.ignoraint.com,https://blog.ignoraint.com,https://aiforbiz.beyond9to5club.com,http://localhost:8080")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const pick = origin && allow.includes(origin) ? origin : allow[0] ?? "*";
  return {
    "Access-Control-Allow-Origin": pick,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

function json(body: unknown, req: Request, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...corsHeaders(req.headers.get("origin")),
      ...(init.headers ?? {}),
    },
  });
}

// ----- Input ----------------------------------------------------------------
type Payload = {
  email?: string;
  first_name?: string;
  source?: string;   // e.g. "blog-footer", "ignoraint-footer"
  list?: string;     // allow override (optional); otherwise uses default
  honey?: string;    // honeypot
};

function validate(p: Payload): string | null {
  if (p.honey && p.honey.trim() !== "") return "spam_detected";
  if (!p.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email.trim())) return "A valid email is required";
  if (p.email.length > 254) return "Email too long";
  if (p.first_name && p.first_name.length > 64) return "First name too long";
  if (p.list && p.list.length > 120) return "List name too long";
  return null;
}

// ----- Welcome email ---------------------------------------------------------
async function sendWelcomeEmail(params: { to: string; firstName: string | null; listName: string; unsubToken: string }) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from   = Deno.env.get("SENDER_FROM") ?? "Addie Agarwal <addie@blog.ignoraint.com>";
  const addr   = Deno.env.get("SENDER_POSTAL_ADDRESS") ?? "Ignoraint LLC · North Carolina, USA";
  if (!apiKey) throw new Error("RESEND_API_KEY missing");

  const safe = params.firstName?.trim() || "friend";
  const unsubUrl = `https://ignoraint.com/crm/unsubscribe.html?token=${params.unsubToken}`;

  const html = `
<p>Hi ${escapeHtml(safe)},</p>

<p>You just subscribed to <strong>You don't have to figure this out alone</strong> — the newsletter from IgnorAInt.</p>

<p>One considered essay a week on using AI well, written for people who learn by doing. No hype, no hot takes, no "10x your life." Just the work.</p>

<p>If you ever want to reply with a question, a struggle, or something you're trying to build, do. I read everything.</p>

<p>See you in your inbox.</p>

<p>Addie Agarwal<br/>
Host — IgnorAInt<br/>
CTO &amp; Director of Marketing — XSITE Capital</p>

<hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px"/>
<p style="color:#888;font-size:12px;line-height:1.5">
  ${escapeHtml(addr)}<br/>
  You're receiving this because you subscribed at ignoraint.com.<br/>
  <a href="${unsubUrl}" style="color:#888">Unsubscribe</a>
</p>`.trim();

  const text = `Hi ${safe},

You just subscribed to "You don't have to figure this out alone" — the newsletter from IgnorAInt.

One considered essay a week on using AI well, written for people who learn by doing. No hype, no hot takes, no "10x your life." Just the work.

If you ever want to reply with a question, a struggle, or something you're trying to build, do. I read everything.

See you in your inbox.

Addie Agarwal
Host — IgnorAInt
CTO & Director of Marketing — XSITE Capital

--
${addr}
You're receiving this because you subscribed at ignoraint.com.
Unsubscribe: ${unsubUrl}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: "You're in — welcome to IgnorAInt.",
      html,
      text,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error(`Resend welcome failed: ${res.status} ${t}`);
  }
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]!));
}

// ----- Handler --------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req.headers.get("origin")) });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, req, { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfigured" }, req, { status: 500 });

  let p: Payload;
  try { p = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, req, { status: 400 }); }

  const v = validate(p);
  if (v === "spam_detected") return json({ ok: true, suppressed: true }, req);
  if (v) return json({ error: v }, req, { status: 400 });

  const email     = p.email!.trim().toLowerCase();
  const firstName = p.first_name?.trim() || null;
  const source    = (p.source ?? "newsletter").trim();
  const listName  = (p.list ?? Deno.env.get("SUBSCRIBE_LIST_NAME") ?? "Blog Subscribers").trim();

  const admin = createClient(supabaseUrl, serviceKey);

  try {
    // Upsert the contact. first_name is only set when it would fill a gap —
    // we don't want a newsletter signup to overwrite a proper name captured
    // by the Zoom form.
    const { data: existing } = await admin
      .from("contacts")
      .select("id, first_name, unsubscribe_token, subscribed")
      .eq("email", email)
      .maybeSingle();

    let contactId: string;
    let unsubToken: string;

    if (existing) {
      contactId  = existing.id as string;
      unsubToken = existing.unsubscribe_token as string;
      // Re-subscribe if they'd previously opted out.
      const updates: Record<string, unknown> = { subscribed: true };
      if (!existing.first_name && firstName) updates.first_name = firstName;
      await admin.from("contacts").update(updates).eq("id", contactId);
    } else {
      const { data: created, error: insErr } = await admin
        .from("contacts")
        .insert({
          email,
          first_name: firstName,
          source,
          registered_at: new Date().toISOString(),
          subscribed: true,
        })
        .select("id, unsubscribe_token")
        .single();
      if (insErr) throw insErr;
      contactId  = created!.id as string;
      unsubToken = created!.unsubscribe_token as string;
    }

    // Ensure list exists.
    let { data: list } = await admin
      .from("lists").select("id").eq("name", listName).maybeSingle();
    if (!list) {
      const { data: created, error: mkErr } = await admin
        .from("lists")
        .insert({ name: listName, description: "Auto-populated by the public newsletter form." })
        .select("id").single();
      if (mkErr) throw mkErr;
      list = created;
    }

    await admin.from("list_contacts")
      .upsert({ list_id: list!.id, contact_id: contactId }, { onConflict: "list_id,contact_id" });

    // Fire welcome email (best-effort — don't block the response on delivery).
    try {
      await sendWelcomeEmail({ to: email, firstName, listName, unsubToken });
    } catch (e) {
      console.error("Welcome email failed:", e);
    }

    return json({
      ok: true,
      message: firstName
        ? `You're in, ${firstName}. Check your inbox for a welcome note.`
        : "You're in. Check your inbox for a welcome note.",
    }, req);
  } catch (e) {
    console.error("Subscribe failed:", e);
    return json({ error: "Couldn't save your subscription. Try again in a moment." }, req, { status: 500 });
  }
});
