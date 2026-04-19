// draft-email — Supabase Edge Function
// ---------------------------------------------------------------------------
// POST with Authorization: Bearer <user JWT>:
//   {
//     prompt: string,              // the user's drafting instruction
//     campaign_id?: uuid,          // if provided, the draft is saved to email_drafts
//     context?: {
//       event_name?: string,
//       event_date?: string,       // e.g. "April 18, 2026"
//       headcount?: number,
//       recap_url?: string,
//       next_event_url?: string,
//       audience?: string,         // e.g. "past attendees", "new registrants"
//       cta?: string,              // e.g. "Reply with your biggest takeaway"
//       tone?: string              // optional override: "warm" | "urgent" | "celebratory"
//     }
//   }
//
// Returns: { subject, preview_text, body_html, body_text, model }
//
// Required env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional:     ANTHROPIC_MODEL (defaults to claude-sonnet-4-6)
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

// ---------------------------------------------------------------------------
// SYSTEM PROMPT — Addie Agarwal's voice
// Derived from the sample email Addie provided as a reference.
// ---------------------------------------------------------------------------
const ADDIE_SYSTEM_PROMPT = `You are drafting emails on behalf of Addie Agarwal for the IgnorAInt community (her AI-for-business masterclass series, hosted via XSITE Capital / Beyond 9-to-5 Club). You are writing TO people who have registered for, attended, or are interested in her events.

== WHO ADDIE IS ==
- Full name: Addie Agarwal
- Title: Host of IgnorAInt · CTO & Director of Marketing at XSITE Capital Investment
- Website: ignoraint.com
- Tone: warm, direct, personal, and generous. An operator who teaches, not a marketer who sells.
- She talks TO people, not AT them. No corporate filler. No hype. No "excited to announce".

== HER VOICE (CHARACTERISTICS) ==
- Opens with a human greeting like "Hello Friends," or "Hi [first_name]," — warm, never formal.
- Short paragraphs. Conversational rhythm. Feels like a letter from a friend who runs a company.
- She references specifics: attendee counts, session names, dates — concrete, not generic.
- She is generous: she gives away recordings, playbooks, and ebooks freely.
- She invites reply and dialogue: "reply to this email", "let me know what resonated", "forward this to a friend who's figuring this out".
- She signs off personally. Signature format:
    Addie Agarwal
    Host — IgnorAInt
    CTO & Director of Marketing — XSITE Capital
- She uses "we" when referring to the IgnorAInt community, "I" when speaking personally.
- She avoids jargon ("synergy", "leverage", "unlock", "deep dive") and buzzword stacks.

== FORMATTING RULES ==
- Use {{first_name}} in greetings when personalizing. Fall back gracefully: "Hello Friends," works when no name is present.
- DO NOT include an unsubscribe link, postal/mailing address, or any CAN-SPAM footer. The send pipeline auto-appends a compliant footer that contains the unsubscribe link AND Ignoraint LLC's postal address — duplicating it clutters the email. Also do not use {{unsubscribe_url}} unless the user explicitly asks for an inline unsubscribe link in the body.
- Keep subjects under 60 characters. No emoji unless the user's prompt explicitly asks for one.
- Preview text: 80–120 characters, continues the subject line's thought, does NOT repeat it.
- HTML: Use semantic, minimal HTML. <p> for paragraphs, <a href="..."> for links, <strong> sparingly. No tables, no inline CSS unless the user asks. Do NOT wrap in <html>/<body> — the send pipeline does that.
- Plain text version: identical content, URLs spelled out in parentheses after link text, blank line between paragraphs. DO NOT include an unsubscribe line or mailing address — same rationale as above.
- Links should use descriptive anchor text, not "click here".

== OUTPUT FORMAT ==
You MUST return a single JSON object — no prose before or after — with exactly these keys:
{
  "subject": "string, under 60 chars",
  "preview_text": "string, 80–120 chars",
  "body_html": "string of HTML fragment, no <html>/<body> wrapper",
  "body_text": "string, plain text version with same content"
}

== SAMPLE (voice reference, do not copy verbatim) ==
Subject: The AI Advantage — recap, recording, and what's next
Preview: 168 of you showed up. Here's the playbook, the recording, and the prompts that actually landed.

Hello Friends,

Thank you for being part of The AI Advantage masterclass yesterday. With 168 of you signed on, it was the biggest room we've had — and the questions in the chat were sharp.

I put together a recap page with the full recording, the playbook, and the ebook we promised: https://ignoraint.com/past-sessions/the-ai-advantage.html

A few of you asked what's next. The next masterclass is on the calendar — details here: https://ignoraint.com/

If something from the session landed for you, hit reply and tell me what you're going to try this week. And if you know someone who's still figuring out how AI fits into their work, forward this to them.

See you at the next one.

Addie Agarwal
Host — IgnorAInt
CTO & Director of Marketing — XSITE Capital

== WHAT TO DO ==
Follow the user's drafting instruction closely. Use the provided context (event name, dates, URLs, headcount) when relevant — do not invent details that weren't given. If context is missing and the email needs it, write around it rather than fabricating. Return JSON only.`;

type AnthropicBlock = { type: string; text?: string };
type AnthropicResponse = { content?: AnthropicBlock[]; model?: string; error?: { message?: string } };

async function claudeDraft(apiKey: string, model: string, userPrompt: string): Promise<{
  subject: string;
  preview_text: string;
  body_html: string;
  body_text: string;
  model: string;
} | { error: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: ADDIE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  const raw = await res.text();
  if (!res.ok) return { error: `Anthropic ${res.status}: ${raw.slice(0, 600)}` };

  let parsed: AnthropicResponse;
  try { parsed = JSON.parse(raw); } catch { return { error: "Failed to parse Anthropic response" }; }
  if (parsed.error) return { error: parsed.error.message ?? "Anthropic returned an error" };

  const text = (parsed.content ?? []).map((b) => b.text ?? "").join("").trim();
  if (!text) return { error: "Empty response from Claude" };

  // Claude should return JSON directly, but be defensive and peel a ```json fence if present.
  let jsonStr = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonStr = fence[1].trim();

  try {
    const draft = JSON.parse(jsonStr);
    if (!draft.subject || !draft.body_html || !draft.body_text) {
      return { error: "Draft is missing required fields (subject, body_html, body_text)" };
    }
    return {
      subject: String(draft.subject),
      preview_text: String(draft.preview_text ?? ""),
      body_html: String(draft.body_html),
      body_text: String(draft.body_text),
      model: parsed.model ?? model,
    };
  } catch {
    return { error: `Could not parse JSON from Claude. Raw: ${text.slice(0, 400)}` };
  }
}

function buildUserPrompt(instruction: string, context: Record<string, unknown> | undefined): string {
  const parts: string[] = [];
  parts.push(`DRAFTING INSTRUCTION:\n${instruction.trim()}`);

  if (context && Object.keys(context).length) {
    parts.push("\nCONTEXT (use only what's relevant; don't invent details):");
    for (const [k, v] of Object.entries(context)) {
      if (v === undefined || v === null || v === "") continue;
      parts.push(`- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
  }

  parts.push("\nReturn a single JSON object with keys: subject, preview_text, body_html, body_text. No prose outside the JSON.");
  return parts.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, { status: 405 });

  const supabaseUrl    = Deno.env.get("SUPABASE_URL");
  const serviceKey     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey        = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const anthropicKey   = Deno.env.get("ANTHROPIC_API_KEY");
  const anthropicModel = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6";

  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfigured: missing Supabase env" }, { status: 500 });
  if (!anthropicKey)               return json({ error: "Server misconfigured: missing ANTHROPIC_API_KEY" }, { status: 500 });

  // --- authenticate caller ---
  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Unauthorized" }, { status: 401 });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: "Unauthorized" }, { status: 401 });

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: profile } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
  if (!profile || !["admin", "editor"].includes(profile.role)) {
    return json({ error: "Forbidden: admin/editor role required" }, { status: 403 });
  }

  // --- input ---
  let payload: { prompt?: string; campaign_id?: string; context?: Record<string, unknown> } = {};
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!payload.prompt || typeof payload.prompt !== "string") {
    return json({ error: "`prompt` is required" }, { status: 400 });
  }

  const userPrompt = buildUserPrompt(payload.prompt, payload.context);

  // --- call Claude ---
  const result = await claudeDraft(anthropicKey, anthropicModel, userPrompt);
  if ("error" in result) return json({ error: result.error }, { status: 502 });

  // --- persist if attached to a campaign ---
  if (payload.campaign_id) {
    await admin.from("email_drafts").insert({
      campaign_id: payload.campaign_id,
      prompt: payload.prompt,
      subject: result.subject,
      body_html: result.body_html,
      body_text: result.body_text,
      model: result.model,
      created_by: userData.user.id,
    });
  }

  return json({
    ok: true,
    subject: result.subject,
    preview_text: result.preview_text,
    body_html: result.body_html,
    body_text: result.body_text,
    model: result.model,
  });
});
