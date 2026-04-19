# IgnorAInt CRM — Setup Guide

This repo contains two things:

1. The marketing site at `ignoraint.com` (everything at the repo root + `past-sessions/`).
2. A self-contained CRM at `crm.ignoraint.com` (`/crm/` + `/supabase/`).

This guide walks you through getting the CRM live end-to-end. Plan on **~45 minutes** the first time.

You'll need accounts with:

- **Supabase** (free tier is fine) — database + auth + edge functions
- **Resend** (you already have this; `blog.ignoraint.com` is verified)
- **Anthropic** (for Claude drafts) — get an API key at https://console.anthropic.com
- **Render** (already hosting the marketing site)

---

## 1 · Create the Supabase project

1. Go to https://supabase.com/dashboard and click **New project**.
2. Name it something like `ignoraint-crm`. Pick the region closest to you. Generate and **save** the database password somewhere safe — you rarely need it, but you can't recover it.
3. Wait for the project to finish provisioning (takes ~1 min).
4. From **Project Settings → API**, copy these three values — you'll use them below:
   - **Project URL** (e.g. `https://abcd1234.supabase.co`)
   - **`anon` public key** (safe to ship in client code)
   - **`service_role` key** (⚠️ server-only — never commit or paste into the frontend)

---

## 2 · Run the database schema

1. In the Supabase dashboard, open **SQL Editor → New query**.
2. Copy the entire contents of `supabase/schema.sql` into the editor and **Run** it.
3. You should see "Success. No rows returned." The schema creates 7 tables, 3 helper functions, row-level security policies, and a trigger that auto-creates a profile row whenever a new auth user is added.

You can verify in **Table Editor** — you'll see `contacts`, `lists`, `list_contacts`, `campaigns`, `campaign_sends`, `email_drafts`, and `profiles`.

---

## 3 · Create your admin user

1. In the Supabase dashboard, go to **Authentication → Users → Add user → Create new user**.
2. Enter your email and a password. Check **Auto Confirm User** so you can log in immediately.
3. Click **Create user**.

The schema's trigger automatically creates a matching row in `public.profiles` with `role = 'admin'` — no extra step needed.

If you want additional editor/viewer accounts later, repeat this flow and then edit their role in **Table Editor → profiles**.

---

## 4 · Install the Supabase CLI (for deploying edge functions)

Edge functions must be deployed via the CLI — the dashboard doesn't host custom functions.

On macOS:
```sh
brew install supabase/tap/supabase
```

Verify: `supabase --version` should print something.

Then log in and link this repo to your project:

```sh
cd /path/to/ignorAInt
supabase login                       # opens a browser
supabase link --project-ref <ref>    # the <ref> is the subdomain of your project URL
```

`<ref>` is the `abcd1234` part of `https://abcd1234.supabase.co`.

---

## 5 · Set the edge function secrets

These are environment variables the functions read at runtime — they live in Supabase, not the repo.

```sh
supabase secrets set \
  RESEND_API_KEY=re_xxxxxxxxxxxxxxxx \
  ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx \
  DEFAULT_FROM_EMAIL=addie@blog.ignoraint.com \
  DEFAULT_FROM_NAME="Addie Agarwal" \
  UNSUBSCRIBE_BASE_URL=https://crm.ignoraint.com/unsubscribe.html \
  ANTHROPIC_MODEL=claude-sonnet-4-6
```

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are injected automatically — do not set those yourself.

---

## 6 · Deploy the three edge functions

```sh
supabase functions deploy send-campaign --no-verify-jwt
supabase functions deploy draft-email   --no-verify-jwt
supabase functions deploy unsubscribe   --no-verify-jwt
```

- All three deploy with `--no-verify-jwt`. This tells the Functions gateway to pass auth headers through instead of trying to verify the JWT itself (which can mis-fire under the new publishable-key system).
- `send-campaign` and `draft-email` still do their own auth check *inside* the function — they call `supabase.auth.getUser(jwt)` and verify the caller has an `admin` or `editor` role in `public.profiles`. The gateway flag only skips the redundant outer check.
- `unsubscribe` is intentionally public so people clicking the link in their email can reach it.

After each deploy, the CLI prints the function URL — sanity-check by running:

```sh
curl -X POST https://<ref>.functions.supabase.co/send-campaign
# → {"error":"Unauthorized"}   ← that's the right answer
```

---

## 7 · Configure the CRM frontend

1. Open `crm/config.js` in this repo.
2. Replace the two `PASTE_…` placeholders with the **Project URL** and **anon key** from step 1.
3. Save. That's it — no build step.

---

## 8 · Host the CRM at `crm.ignoraint.com`

You have two options; pick whichever is easier.

### Option A — Separate Render static site (recommended)
1. In Render, create a **new Static Site** pointing at the same GitHub repo (`ihavespokennow-ops/ignorAInt`).
2. Build command: (leave blank)
3. Publish directory: `crm`
4. After the first deploy, open the site's **Settings → Custom Domains** and add `crm.ignoraint.com`.
5. Render will show you a CNAME target (e.g. `xxx.onrender.com`). Add that CNAME in your DNS provider for the `crm` subdomain.
6. Wait for DNS + TLS to provision (usually a few minutes).

### Option B — Host `/crm/` on the existing site
If you'd rather keep one Render service, the CRM is already at `ignoraint.com/crm/`. You can either:
- Use that URL directly, or
- Add a Render **Redirect/Rewrite** rule sending `crm.ignoraint.com` → `ignoraint.com/crm/`.

Either way, update the `UNSUBSCRIBE_BASE_URL` secret (step 5) to match whatever URL you actually use:

```sh
supabase secrets set UNSUBSCRIBE_BASE_URL=https://crm.ignoraint.com/unsubscribe.html
# or, for option B:
supabase secrets set UNSUBSCRIBE_BASE_URL=https://ignoraint.com/crm/unsubscribe.html
```

---

## 9 · Log in

1. Visit `https://crm.ignoraint.com` (or wherever you hosted it).
2. Sign in with the admin account you created in step 3.
3. You should land on the Dashboard with zeroed-out stats.

---

## 10 · Import your Zoom registration list

1. In Zoom, pull up the registration report for your masterclass (**Reports → Meeting → Registration Report**) and export as CSV.
2. In the CRM, go to **Contacts → Import Zoom CSV**.
3. Pick the file, optionally select a list to add them to, and hit Import.

Zoom's export has a preamble above the column header — the parser auto-skips it and looks for `Email`, `First Name`, `Last Name`.

---

## 11 · Send your first campaign

1. Go to **Campaigns → + New campaign**. Name it, pick a list.
2. In the editor, use the **Draft with Claude** box: describe the email you want (e.g. *"Recap yesterday's AI Advantage masterclass. Mention the 168 attendees, link to the recap page at https://ignoraint.com/past-sessions/the-ai-advantage.html, invite replies, encourage forwards."*).
3. Click **Generate draft**. Claude returns subject, preview text, HTML, and plain text — all in your voice.
4. Review and edit in the editor. The preview pane on the right shows exactly what the recipient sees.
5. Hit **Send test** to yourself first. Verify it looks right in your inbox.
6. When you're happy, hit **Send to list** and confirm.

---

## Local development

You don't need to — the CRM has no build step. Just open `crm/index.html` in a browser after filling in `config.js`. Supabase accepts requests from `file://` and `localhost` by default.

If you want to test edge functions locally:
```sh
supabase functions serve send-campaign --env-file ./supabase/.env.local
```

(where `.env.local` has the same keys you set with `supabase secrets set`).

---

## Troubleshooting

- **"Unauthorized" on any edge function call** — your admin profile row doesn't exist or has the wrong role. Check `public.profiles` in Table Editor. Should have `role = 'admin'` (or `'editor'`).
- **"No subscribed contacts in the list"** — the list is empty or everyone in it has `subscribed = false`. Add contacts to the list and/or flip them back to subscribed.
- **Resend errors about the `from` address** — confirm `blog.ignoraint.com` is verified in the Resend dashboard (SPF, DKIM, DMARC all green).
- **Unsubscribe page shows "CRM config missing"** — you forgot to paste the anon key into `crm/config.js`, or the deployed version is stale.
- **Claude drafts come back malformed** — bump `max_tokens` in `supabase/functions/draft-email/index.ts`, redeploy.
- **Schema re-run errors** — the schema is idempotent, but if you hit conflicts (e.g. after renaming something), run `drop schema public cascade; create schema public;` first, then re-run `schema.sql`. That nukes all data — only do it before you have real contacts.

---

## Security reminders

- **Never commit** your `service_role` key, `RESEND_API_KEY`, or `ANTHROPIC_API_KEY`. They belong in `supabase secrets`, nowhere else.
- The GitHub PAT used for the initial push was shared in chat — **rotate it** at https://github.com/settings/tokens if you haven't already.
- The `anon` key in `crm/config.js` is safe to ship: RLS + admin-only policies make sure it can't do anything without a logged-in admin JWT.
- Password recovery: Supabase can email magic links if you enable SMTP in **Project Settings → Auth** — optional.
