// zoom-register — PUBLIC Supabase Edge Function
// ---------------------------------------------------------------------------
// Powers the branded signup modal on ignoraint.com. Two modes:
//
//   FULL MODE (when Zoom Server-to-Server OAuth is configured):
//     Registers the visitor with Zoom's API → returns their personal join URL
//     → emails a branded confirmation. One-click experience, no Zoom page.
//
//   HYBRID MODE (when S2S OAuth is NOT yet configured — current state):
//     Captures the contact in the CRM, then returns the public Zoom
//     registration URL with name + email prefilled as query params. Form
//     auto-redirects them to Zoom to finish in one click. We still own the
//     lead and can send follow-ups via the campaign system.
//
// Mode is auto-detected at request time based on whether ZOOM_ACCOUNT_ID etc.
// are set. To upgrade from hybrid → full, set the four ZOOM_* secrets and the
// function flips automatically. No code change.
//
// Deploy with:  supabase functions deploy zoom-register --no-verify-jwt
//
// Required env:
//   SUPABASE_URL                    (auto)
//   SUPABASE_SERVICE_ROLE_KEY       (auto)
//   ZOOM_REGISTRATION_URL           Public Zoom register URL — used in HYBRID mode.
//                                   e.g. https://zoom.us/meeting/register/xyz123
//
// Required for FULL mode (omit to run in HYBRID mode):
//   ZOOM_ACCOUNT_ID                 Server-to-Server OAuth — Account ID
//   ZOOM_CLIENT_ID                  Server-to-Server OAuth — Client ID
//   ZOOM_CLIENT_SECRET              Server-to-Server OAuth — Client Secret
//   ZOOM_MEETING_ID                 Numeric Zoom meeting id to register for
//   RESEND_API_KEY                  (already set)
//   SENDER_FROM                     e.g. "Addie Agarwal <addie@blog.ignoraint.com>"
//   SENDER_POSTAL_ADDRESS           (already set — reused for footer)
//
// Optional env:
//   REGISTRATION_LIST_NAME          CRM list new registrants are added to.
//                                   Defaults to "AI Masterclass registrants".
//                                   Created automatically if missing.
//   ALLOWED_ORIGINS                 Comma-separated CORS allowlist. Default:
//                                   https://ignoraint.com,https://www.ignoraint.com,http://localhost:8080
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ----- CORS ------------------------------------------------------------------
function corsHeaders(origin: string | null) {
  const allow = (Deno.env.get("ALLOWED_ORIGINS") ??
    "https://ignoraint.com,https://www.ignoraint.com,https://aiforbiz.beyond9to5club.com,http://localhost:8080")
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

// ----- Zoom OAuth ------------------------------------------------------------
// Tokens are good for ~1h. We cache in the function's module scope so warm
// invocations don't re-mint a new token for every request.
let zoomToken: { access_token: string; expires_at: number } | null = null;

async function getZoomToken(): Promise<string> {
  const now = Date.now();
  if (zoomToken && now < zoomToken.expires_at - 60_000) return zoomToken.access_token;

  const accountId    = Deno.env.get("ZOOM_ACCOUNT_ID");
  const clientId     = Deno.env.get("ZOOM_CLIENT_ID");
  const clientSecret = Deno.env.get("ZOOM_CLIENT_SECRET");
  if (!accountId || !clientId || !clientSecret) throw new Error("Zoom OAuth env missing");

  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Zoom auth ${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as { access_token: string; expires_in: number };
  zoomToken = { access_token: body.access_token, expires_at: now + body.expires_in * 1000 };
  return body.access_token;
}

// ----- Resend ----------------------------------------------------------------
async function sendConfirmationEmail(params: {
  to: string;
  firstName: string;
  joinUrl: string;
  topic: string;
  startTime?: string;
}) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from   = Deno.env.get("SENDER_FROM") ?? "Addie Agarwal <addie@blog.ignoraint.com>";
  const addr   = Deno.env.get("SENDER_POSTAL_ADDRESS") ?? "Ignoraint LLC · North Carolina, USA";
  if (!apiKey) throw new Error("RESEND_API_KEY missing");

  const safeName = params.firstName?.trim() || "friend";
  const when = params.startTime
    ? new Date(params.startTime).toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
        timeZoneName: "short",
      })
    : null;

  const html = `
<p>Hi ${escapeHtml(safeName)},</p>

<p>You're registered for <strong>${escapeHtml(params.topic)}</strong>${when ? ` on <strong>${escapeHtml(when)}</strong>` : ""}.</p>

<p><strong>Your personal join link:</strong><br/>
<a href="${params.joinUrl}">${params.joinUrl}</a></p>

<p>Save this email — your link is unique to you and it's how I'll know you made it.</p>

<p>A few things to expect:</p>
<ul>
  <li>We start on time. Join a few minutes early if you can.</li>
  <li>Camera optional. Bring a notebook — you'll want to write things down.</li>
  <li>Reply to this email any time with questions, or what you're hoping to get out of the session.</li>
</ul>

<p>See you there.</p>

<p>Addie Agarwal<br/>
Host — IgnorAInt<br/>
CTO &amp; Director of Marketing — XSITE Capital</p>

<hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px"/>
<p style="color:#888;font-size:12px;line-height:1.5">
  ${escapeHtml(addr)}<br/>
  You're receiving this because you registered for an IgnorAInt masterclass.
</p>`.trim();

  const text = `Hi ${safeName},

You're registered for ${params.topic}${when ? ` on ${when}` : ""}.

Your personal join link:
${params.joinUrl}

Save this email — your link is unique to you and it's how I'll know you made it.

A few things to expect:
- We start on time. Join a few minutes early if you can.
- Camera optional. Bring a notebook.
- Reply any time with questions or what you're hoping to get out of the session.

See you there.

Addie Agarwal
Host — IgnorAInt
CTO & Director of Marketing — XSITE Capital

--
${addr}
You're receiving this because you registered for an IgnorAInt masterclass.`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: `You're in — ${params.topic}`,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    // Log but don't fail the whole registration — Zoom will also send its own
    // email. Registration succeeded; the confirmation email didn't.
    console.error(`Resend failed: ${res.status} ${errText}`);
  }
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]!));
}

// ----- Input validation ------------------------------------------------------
type Payload = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  source?: string;      // "ignoraint.com", "aiforbiz", etc. for attribution
  honey?: string;       // honeypot — must be empty
};

function validate(p: Payload): string | null {
  if (p.honey && p.honey.trim() !== "") return "spam_detected";
  if (!p.first_name || !p.first_name.trim()) return "First name is required";
  if (!p.last_name  || !p.last_name.trim())  return "Last name is required";
  if (!p.email      || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email.trim())) return "A valid email is required";
  if (!p.phone      || p.phone.replace(/\D/g, "").length < 7) return "A valid phone number is required";
  if (p.first_name.length > 64 || p.last_name.length > 64 || p.email.length > 254) return "Inputs too long";
  if (p.phone.length > 32) return "Phone number too long";
  return null;
}

// ----- Handler ---------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req.headers.get("origin")) });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, req, { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const meetingId   = Deno.env.get("ZOOM_MEETING_ID");
  const accountId   = Deno.env.get("ZOOM_ACCOUNT_ID");
  const clientId    = Deno.env.get("ZOOM_CLIENT_ID");
  const clientSec   = Deno.env.get("ZOOM_CLIENT_SECRET");
  const publicRegUrl = Deno.env.get("ZOOM_REGISTRATION_URL");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Server misconfigured" }, req, { status: 500 });
  }

  // Decide mode. FULL needs all four S2S values + meeting id. Otherwise run
  // HYBRID (needs only ZOOM_REGISTRATION_URL).
  const fullMode = Boolean(accountId && clientId && clientSec && meetingId);
  if (!fullMode && !publicRegUrl) {
    return json({ error: "Server misconfigured: set ZOOM_REGISTRATION_URL (or the four ZOOM_* OAuth secrets for full mode)" }, req, { status: 500 });
  }

  let p: Payload;
  try { p = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, req, { status: 400 }); }

  const v = validate(p);
  if (v === "spam_detected") return json({ ok: true, suppressed: true }, req); // silently drop bots
  if (v) return json({ error: v }, req, { status: 400 });

  const firstName = p.first_name!.trim();
  const lastName  = p.last_name!.trim();
  const email     = p.email!.trim().toLowerCase();
  const phone     = (p.phone ?? "").trim() || null;
  const source    = (p.source ?? "ignoraint.com").trim();

  // --- 1. Get a join URL (full mode) or a prefilled register URL (hybrid) ---
  let joinUrl: string;
  let meetingTopic = "The AI Masterclass";
  let meetingStart: string | undefined;
  let mode: "full" | "hybrid" = fullMode ? "full" : "hybrid";

  if (fullMode) {
    try {
      const accessToken = await getZoomToken();

      // Grab meeting metadata for the confirmation email subject/body.
      try {
        const metaRes = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (metaRes.ok) {
          const meta = await metaRes.json();
          if (meta.topic)      meetingTopic = meta.topic;
          if (meta.start_time) meetingStart = meta.start_time;
        }
      } catch (_) { /* non-fatal */ }

      const regRes = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}/registrants`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName,
          last_name:  lastName,
          email,
          phone:      phone ?? undefined,
          custom_questions: source ? [{ title: "Source", value: source }] : undefined,
        }),
      });
      const regText = await regRes.text();
      if (!regRes.ok) {
        let friendly = `Registration failed (${regRes.status}).`;
        try {
          const j = JSON.parse(regText);
          if (j.message) friendly = j.message;
        } catch (_) { /* ignore */ }
        console.error("Zoom register failed:", regText);
        return json({ error: friendly }, req, { status: 502 });
      }
      const reg = JSON.parse(regText) as { join_url: string; registrant_id: string };
      joinUrl = reg.join_url;
    } catch (e) {
      console.error(e);
      return json({ error: "Couldn't reach Zoom. Try again in a moment." }, req, { status: 502 });
    }
  } else {
    // HYBRID: append name + email to Zoom's public registration URL. Zoom
    // honors `first_name`, `last_name`, and `email` query params on most
    // registration pages — when it doesn't, the user just has to confirm
    // their already-entered values on Zoom's page.
    const u = new URL(publicRegUrl!);
    u.searchParams.set("first_name", firstName);
    u.searchParams.set("last_name",  lastName);
    u.searchParams.set("email",      email);
    joinUrl = u.toString();
  }

  // --- 2. Upsert contact + add to registration list ------------------------
  const admin = createClient(supabaseUrl, serviceKey);
  const listName = Deno.env.get("REGISTRATION_LIST_NAME") ?? "AI Masterclass registrants";

  try {
    // Upsert contact by email (case-insensitive via citext column).
    const { data: contactRow, error: contactErr } = await admin
      .from("contacts")
      .upsert({
        email,
        first_name: firstName,
        last_name:  lastName,
        phone,
        source,
        registered_at: new Date().toISOString(),
        subscribed: true,
      }, { onConflict: "email" })
      .select("id")
      .single();
    if (contactErr) throw contactErr;

    // Ensure the registration list exists, then link.
    let { data: list } = await admin
      .from("lists").select("id").eq("name", listName).maybeSingle();
    if (!list) {
      const { data: created, error: mkErr } = await admin
        .from("lists").insert({ name: listName, description: "Auto-populated by the public signup form." })
        .select("id").single();
      if (mkErr) throw mkErr;
      list = created;
    }
    await admin.from("list_contacts")
      .upsert({ list_id: list!.id, contact_id: contactRow!.id }, { onConflict: "list_id,contact_id" });
  } catch (e) {
    // Don't block the user — they're already registered with Zoom.
    console.error("CRM sync failed:", e);
  }

  // --- 3. Send branded confirmation email ----------------------------------
  // FULL mode: we have a real personal join URL — send our branded email now.
  // HYBRID mode: the visitor hasn't actually finished Zoom's form yet, so Zoom
  // will send the official confirmation once they do. Sending ours first would
  // be premature and could confuse them with duplicate "join links".
  if (fullMode) {
    try {
      await sendConfirmationEmail({
        to: email,
        firstName,
        joinUrl,
        topic: meetingTopic,
        startTime: meetingStart,
      });
    } catch (e) {
      console.error("Confirmation email failed:", e);
    }
  }

  const message = fullMode
    ? `You're registered, ${firstName}. Check ${email} for your personal join link.`
    : `You're saved, ${firstName} — one quick step left on Zoom.`;

  return json({
    ok: true,
    mode,
    message,
    join_url: joinUrl,
  }, req);
});
