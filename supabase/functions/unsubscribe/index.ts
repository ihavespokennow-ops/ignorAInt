// unsubscribe — public Supabase Edge Function
// ---------------------------------------------------------------------------
// Public endpoint (no auth) that flips contacts.subscribed to false when the
// caller presents a matching one-time token. Also responds to RFC 8058
// "List-Unsubscribe-Post: List-Unsubscribe=One-Click" headers (POST with
// query params, no body).
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, apikey",
};

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfigured" }, { status: 500 });

  // Accept token from JSON body OR query string (covers one-click POSTs).
  let contactId: string | null = null;
  let token: string | null = null;

  const url = new URL(req.url);
  contactId = url.searchParams.get("c");
  token     = url.searchParams.get("t");

  if (req.method === "POST") {
    const ctype = req.headers.get("content-type") ?? "";
    if (ctype.includes("application/json")) {
      try {
        const body = await req.json();
        contactId = body.contact_id ?? contactId;
        token     = body.token      ?? token;
      } catch { /* no-op — query string fallback */ }
    } else if (ctype.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const form = new URLSearchParams(text);
      contactId = form.get("c") ?? contactId;
      token     = form.get("t") ?? token;
    }
  }

  if (!contactId || !token) return json({ error: "Missing contact_id or token" }, { status: 400 });

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: contact, error: cErr } = await admin
    .from("contacts")
    .select("id, unsubscribe_token, subscribed")
    .eq("id", contactId)
    .single();

  if (cErr || !contact)             return json({ error: "Invalid link" }, { status: 404 });
  if (contact.unsubscribe_token !== token) return json({ error: "Invalid token" }, { status: 403 });

  if (contact.subscribed) {
    const { error: uErr } = await admin.from("contacts").update({ subscribed: false }).eq("id", contactId);
    if (uErr) return json({ error: uErr.message }, { status: 500 });
  }
  return json({ ok: true });
});
