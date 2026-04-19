# IgnorAInt

The official site + CRM for **IgnorAInt** (the AI masterclass series by XSITE Capital).

## What's in this repo

### Marketing site (`ignoraint.com`)
- `index.html` — landing page
- `past-sessions.html` + `past-sessions/` — blog-style archive of past masterclasses
- `styles.css` / `colors_and_type.css` — design tokens + site styles
- `assets/` — images, logos, illustrations, SVGs

### CRM (`crm.ignoraint.com`)
- `crm/` — the admin SPA (vanilla JS + Supabase, no build step). Login, contacts, lists, campaigns, AI drafting.
- `supabase/schema.sql` — the Postgres schema (run once in the Supabase SQL editor)
- `supabase/functions/` — three Deno edge functions:
  - `send-campaign` — sends a campaign via Resend, records each attempt
  - `draft-email` — generates a draft in Addie's voice via the Claude API
  - `unsubscribe` — public endpoint for one-click unsubscribes

**For CRM setup, see [SETUP.md](SETUP.md)** — step-by-step from a blank Supabase project to sending your first campaign.

## Local preview of the site

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying the site

Point Render (or Netlify / Vercel / GitHub Pages) at this repo. `index.html` is at the root — no build command required.

The CRM is deployed separately; see SETUP.md.
