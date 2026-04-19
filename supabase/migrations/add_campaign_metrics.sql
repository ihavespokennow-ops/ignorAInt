-- Campaign metrics — Resend webhook event tracking
-- -----------------------------------------------------------------------------
-- Adds per-recipient engagement timestamps & counters to campaign_sends, plus
-- an aggregation view (campaign_metrics) the UI reads to render the dashboard.
-- Re-running this file is safe (every change is `if not exists` / `or replace`).
-- -----------------------------------------------------------------------------

-- 1. Per-recipient engagement columns -----------------------------------------
alter table public.campaign_sends
  add column if not exists delivered_at      timestamptz,
  add column if not exists first_opened_at   timestamptz,
  add column if not exists last_opened_at    timestamptz,
  add column if not exists open_count        integer not null default 0,
  add column if not exists first_clicked_at  timestamptz,
  add column if not exists last_clicked_at   timestamptz,
  add column if not exists click_count       integer not null default 0,
  add column if not exists bounced_at        timestamptz,
  add column if not exists bounce_type       text,
  add column if not exists complained_at     timestamptz,
  add column if not exists unsubscribed_at   timestamptz,
  add column if not exists last_event_at     timestamptz;

-- 2. Indexes ------------------------------------------------------------------
-- Webhook handler looks up rows by Resend's message id.
create unique index if not exists campaign_sends_provider_message_id_uidx
  on public.campaign_sends (provider_message_id)
  where provider_message_id is not null;

create index if not exists campaign_sends_first_opened_idx
  on public.campaign_sends (first_opened_at)
  where first_opened_at is not null;

create index if not exists campaign_sends_first_clicked_idx
  on public.campaign_sends (first_clicked_at)
  where first_clicked_at is not null;

-- 3. Aggregation view used by the UI dashboard -------------------------------
create or replace view public.campaign_metrics as
select
  c.id                                                              as campaign_id,
  c.name,
  c.subject,
  c.status,
  c.list_id,
  c.sent_at,
  count(*)                                                          as total,
  count(*) filter (where s.status = 'sent')                         as sent_count,
  count(*) filter (where s.status = 'failed')                       as failed_count,
  count(*) filter (where s.status = 'pending')                      as pending_count,
  count(*) filter (where s.status = 'skipped')                      as skipped_count,
  count(*) filter (where s.delivered_at     is not null)            as delivered_count,
  count(*) filter (where s.first_opened_at  is not null)            as opened_count,
  count(*) filter (where s.first_clicked_at is not null)            as clicked_count,
  count(*) filter (where s.bounced_at       is not null)            as bounced_count,
  count(*) filter (where s.complained_at    is not null)            as complained_count,
  count(*) filter (where s.unsubscribed_at  is not null)            as unsubscribed_count,
  coalesce(sum(s.open_count), 0)                                    as total_opens,
  coalesce(sum(s.click_count), 0)                                   as total_clicks
from public.campaigns c
left join public.campaign_sends s on s.campaign_id = c.id
group by c.id;

-- 4. Per-recipient detail view (joins contact info) ---------------------------
create or replace view public.campaign_send_details as
select
  s.id,
  s.campaign_id,
  s.contact_id,
  ct.email,
  ct.first_name,
  ct.last_name,
  s.status,
  s.provider_message_id,
  s.error,
  s.sent_at,
  s.delivered_at,
  s.first_opened_at,
  s.last_opened_at,
  s.open_count,
  s.first_clicked_at,
  s.last_clicked_at,
  s.click_count,
  s.bounced_at,
  s.bounce_type,
  s.complained_at,
  s.unsubscribed_at,
  s.last_event_at
from public.campaign_sends s
join public.contacts ct on ct.id = s.contact_id;

-- 5. Webhook event log (raw, append-only) ------------------------------------
-- Lets us audit / replay Resend events and debug delivery issues.
create table if not exists public.email_events (
  id                  uuid primary key default gen_random_uuid(),
  provider_message_id text,
  campaign_send_id    uuid references public.campaign_sends(id) on delete set null,
  event_type          text not null,
  occurred_at         timestamptz,
  payload             jsonb not null,
  received_at         timestamptz not null default now()
);
create index if not exists email_events_message_idx  on public.email_events (provider_message_id);
create index if not exists email_events_send_idx     on public.email_events (campaign_send_id);
create index if not exists email_events_type_idx     on public.email_events (event_type);
create index if not exists email_events_received_idx on public.email_events (received_at desc);

alter table public.email_events enable row level security;
drop policy if exists "admin all email_events" on public.email_events;
create policy "admin all email_events"
  on public.email_events for all
  using (public.is_admin())
  with check (public.is_admin());
