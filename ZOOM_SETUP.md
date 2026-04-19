# Zoom Registration — Setup Guide

The branded signup form on `ignoraint.com` replaces the "Reserve seat" buttons
that used to redirect to Zoom. It collects name/email/phone, registers the
person with Zoom via API, adds them to the CRM, and emails them a personal
Zoom join link styled in Addie's voice.

This guide is what Addie needs to do **one time** to make it work.

---

## 1. Create a Zoom Server-to-Server OAuth app

This is a private, machine-to-machine app — it lives inside your own Zoom
account, no Marketplace approval required.

1. Go to <https://marketplace.zoom.us/develop/create>.
2. Click **Server-to-Server OAuth** → **Create**.
3. Name it something like `IgnorAInt CRM` → **Create**.
4. On the next screen, copy these three values somewhere safe:
   - **Account ID**
   - **Client ID**
   - **Client Secret**
5. **Information** tab: fill in any non-empty values (Zoom requires them; they
   don't appear anywhere public).
6. **Scopes** tab: click **Add scopes** and enable:
   - `meeting:read:meeting:admin` (read meeting details)
   - `meeting:write:registrant:admin` (add registrants)
   - *(If your meeting lives under a specific user rather than the account
     admin, also add `user:read:user:admin`.)*
7. **Activation** tab: click **Activate your app**.

> If you can't add the `:admin` scopes, use the matching non-admin versions —
> `meeting:read` / `meeting:write` — they work identically for your own
> meetings.

---

## 2. Find the numeric meeting ID

The URL `https://zoom.us/meeting/register/gRbQarQkSlC5Ik7cFGR3NA` uses an
encrypted id. The API needs the **numeric** id.

1. Sign in to <https://zoom.us/meeting>.
2. Click your upcoming masterclass meeting.
3. At the top of the meeting page, "Meeting ID:" will show an 11-digit number
   like `851 2345 6789`. **Remove the spaces** → that's the value to save.

---

## 3. Save the secrets in Supabase

Once you have the four values — Account ID, Client ID, Client Secret, and
Meeting ID — run these (in the terminal where the `supabase` CLI is already
set up):

```bash
supabase secrets set --project-ref qphagqshsrdeefspxhss \
  ZOOM_ACCOUNT_ID="..." \
  ZOOM_CLIENT_ID="..." \
  ZOOM_CLIENT_SECRET="..." \
  ZOOM_MEETING_ID="85123456789"
```

> Or paste them to me and I'll run it for you — I already have the CLI ready.

---

## 4. (Recommended) Turn on registration-required on the meeting

In your Zoom meeting settings:

- **Registration** → make sure it's enabled (*Required*).
- **Registration options** → **Approval** → **Automatically approve**. If it's
  set to *Manual approval*, people won't get a join link until you approve
  them one by one.
- Under **Email settings** you can turn *off* Zoom's "Email contact when
  registering" confirmation if you want only our branded email to go out.
  Keeping Zoom's on is fine too — it's a backup if ours ever fails.

---

## 5. Test it

1. Go to <https://ignoraint.com> and click **Reserve my free seat**.
2. Register yourself with a throwaway email (e.g. `you+test1@gmail.com`).
3. Verify:
   - The modal flips to the success state with a working **Open Zoom now →**
     button.
   - You received the branded confirmation email within ~30s.
   - The contact now appears in the CRM under *Contacts*, and is a member of
     the **AI Masterclass registrants** list.

If anything errors, the message surfaces in the form itself. Full stack traces
are visible in the Supabase dashboard:
<https://supabase.com/dashboard/project/qphagqshsrdeefspxhss/functions/zoom-register/logs>

---

## What I built

- **`supabase/functions/zoom-register`** — public edge function (no JWT)
  callable from the form. Handles the whole flow: Zoom OAuth, register the
  person, upsert into the CRM, send the branded confirmation email via Resend.
- **Modal form on `index.html`** — single-file, matches the existing ember +
  ink palette. Name / email / phone, honeypot against bots, inline
  validation, loading & error states, success state linking straight to Zoom.
- **All three "Reserve"/"Save my spot" CTAs** on the homepage now trigger the
  modal instead of jumping to zoom.us.

## Switching events later

The meeting ID is stored as a Supabase secret, so rolling over to the next
masterclass is just:

```bash
supabase secrets set --project-ref qphagqshsrdeefspxhss ZOOM_MEETING_ID="..."
```

No code deploy needed. The function auto-picks up the topic/date from the
meeting metadata so the confirmation email always has the right info.
