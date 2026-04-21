# Apple Mail Deliverability Audit — blog.ignoraint.com

**Audit date:** 2026-04-21
**Sending domain:** `blog.ignoraint.com` via Resend
**Symptom:** Mail from `addie@blog.ignoraint.com` is routed to Junk in Apple Mail even when sent to a recipient who has previously replied.

## TL;DR

You are missing three Apple-specific deliverability signals and one DNS-level signal. None of them are catastrophic on their own, but Apple's junk filter stacks weak signals, and you are currently stacking four. Fixing the headers (which I can do right now in code) plus adding two DNS records should materially change Apple's classification inside about 24–72 hours.

## What I checked

### DNS (verified via `dig`)

| Record | Value | Verdict |
|---|---|---|
| `blog.ignoraint.com` SPF | _none_ | Missing — should explicitly include Resend |
| `ignoraint.com` SPF | `v=spf1 include:_spf.google.com ~all` | Google Workspace only; does not cover Resend |
| `resend._domainkey.blog.ignoraint.com` DKIM | valid RSA public key | OK |
| `_dmarc.blog.ignoraint.com` | _none_ (inherits org) | Relies on root `_dmarc` via organizational policy |
| `_dmarc.ignoraint.com` | `p=none; aspf=r; adkim=r` | Monitor-only. Apple treats `p=none` as a weak auth stance |
| `blog.ignoraint.com` MX | _none_ | Sending-only subdomain — fine for sending, but some filters penalize for reply-surface ambiguity |
| `default._bimi.ignoraint.com` | _none_ | No BIMI. Not required, but BIMI-eligible senders get visible trust boost in Apple Mail |

### Outgoing email headers (from `supabase/functions/*/index.ts`)

**Campaign emails (`send-campaign`):**

- `From: Addie <addie@blog.ignoraint.com>` ✅
- `List-Unsubscribe: <https://...unsubscribe?...>` ⚠️ (https only, missing `mailto:` variant — Apple Mail prefers both)
- `List-Unsubscribe-Post: List-Unsubscribe=One-Click` ✅
- `Feedback-ID` ❌ (not set — useful for Apple/Google deliverability telemetry)
- Plain-text + HTML multipart ✅

**Welcome email (`subscribe`):**

- `List-Unsubscribe` ❌ **not present at all** — this is the biggest single issue. As of Feb 2024 Apple and Google require `List-Unsubscribe` + `List-Unsubscribe-Post` for bulk senders, and the welcome email is the very first touchpoint that Apple's filter learns from.
- `List-Unsubscribe-Post` ❌ missing
- `Feedback-ID` ❌ missing

## Root-cause theory

Apple Mail is not looking at content; it is looking at first-contact signals:

1. **Cold subdomain.** `blog.ignoraint.com` started sending volume only recently. Apple Mail's reputation model on a new subdomain starts from "slightly suspicious" and only warms up based on positive engagement signals.
2. **Weak DMARC stance.** `p=none` with no subdomain policy means Apple cannot infer whether you intend forged mail to be rejected. Senders who publish `p=quarantine` or `p=reject` look more serious.
3. **No explicit SPF on the sending subdomain.** DMARC passes on DKIM alignment (which is working), so this is not fatal, but Apple weighs "both SPF and DKIM pass" higher than "only DKIM passes."
4. **Welcome email missing `List-Unsubscribe`.** Recipients who mark your welcome as spam (because they can't easily unsubscribe) directly train Apple's filter against you.
5. **No `Feedback-ID`.** Without it, you can't segment complaints by campaign in postmaster tools, and Apple's filter has one less legitimacy signal.

## Action plan (in priority order)

### 1. Code fixes I can implement now (biggest immediate impact)

- Add `List-Unsubscribe` (https + mailto) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers to the welcome email in `supabase/functions/subscribe/index.ts`
- Add `mailto:unsubscribe@ignoraint.com` as a second List-Unsubscribe variant to campaigns in `supabase/functions/send-campaign/index.ts`
- Add `Feedback-ID` header to both functions, formatted `campaign-id:list-id:resend:ignoraint` so bounces/complaints are segmentable
- Redeploy both functions with `--no-verify-jwt`

### 2. DNS fixes you do in your registrar (24–48 h propagation)

Add the following records:

- **SPF on the sending subdomain** — TXT at `blog.ignoraint.com`:
  ```
  v=spf1 include:_spf.resend.com ~all
  ```
  (Replace with Resend's current recommended include from their dashboard — they'll show it in the domain-verification page. The example above is the common value.)

- **Subdomain DMARC** — TXT at `_dmarc.blog.ignoraint.com`:
  ```
  v=DMARC1; p=quarantine; rua=mailto:addie@ignoraint.com; aspf=s; adkim=s; pct=100;
  ```
  Strict alignment (`s`) is safe here because Resend signs with `blog.ignoraint.com` DKIM and you're not sending any other mail from the subdomain.

- **Tighten root DMARC** — TXT at `_dmarc.ignoraint.com`, update to:
  ```
  v=DMARC1; p=quarantine; rua=mailto:addie@ignoraint.com; ruf=mailto:addie@ignoraint.com; pct=100; aspf=r; adkim=r; sp=quarantine;
  ```
  Only do this after you've watched `p=none` DMARC reports for a week with no alignment failures. If you want, I can walk you through reading the `rua` reports first.

### 3. Warm-up and engagement (days to weeks)

- **Send a low-volume, high-engagement sequence first.** Hand-picked list of 10–20 people who are likely to reply. Replies are the strongest positive signal Apple tracks.
- **Ask one high-trust recipient to mark a message Not Junk** on their Apple device. This writes a per-recipient allow that generalizes slightly in Apple's model.
- **Send consistent cadence.** Sporadic bursts look more like spam than a steady 1–2 emails/week.
- **Avoid link-shorteners and tracking pixels from low-rep domains.** Resend's own tracking domain is fine; avoid bit.ly or unknown redirectors.

### 4. Optional higher-trust signals

- **BIMI with a VMC** — requires you to trademark the IgnorAInt logo and buy a Verified Mark Certificate (~$1.5k/yr). Only worth it if email is a major channel for the business. Skip for now.
- **Reply-To pointing at a human-monitored inbox** — if you're not already doing this, set `reply_to` on campaigns to `addie@ignoraint.com` (root domain, Google Workspace-monitored). Replies improve reputation faster than any DNS change.
- **Monitor via** Google Postmaster Tools (already done), plus Apple iCloud does not offer a postmaster portal — DMARC aggregate reports (`rua=`) are your only visibility into Apple's auth decisions.

## What to expect after the fixes land

- Code + header fixes: within hours of redeploy, Apple Mail should stop flagging based on the header signals. New recipients should see inbox placement more often, but recipients who already trained their filter on the old mail need to mark "Not Junk" once.
- DNS fixes: 24–72 h to propagate and be picked up by Apple's reputation model. DMARC tightening to `quarantine` is a multi-week trust build.
- Reputation warm-up: meaningful change within 2–3 weeks if engagement is good.

## Sources used in this audit

- `dig` TXT/MX lookups on `ignoraint.com`, `blog.ignoraint.com`, `_dmarc.*`, `resend._domainkey.blog.ignoraint.com`
- `supabase/functions/send-campaign/index.ts` (lines 291, 317-320)
- `supabase/functions/subscribe/index.ts` (lines 133-143)
- Apple Mail / iCloud deliverability guidance (2024 bulk-sender requirements)
- Resend DNS verification documentation
