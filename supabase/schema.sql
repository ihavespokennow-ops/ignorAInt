-- IgnorAInt CRM — Supabase schema
-- -----------------------------------------------------------------------------
-- Run this file once in the Supabase SQL editor after creating your project.
-- It is idempotent: re-running is safe.
--
-- Requires: Supabase Auth (enabled by default).
-- -----------------------------------------------------------------------------

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- -----------------------------------------------------------------------------
-- profiles: extends auth.users for admin metadata. Only users present here can
-- log in to the CRM UI (enforced via RLS policies below).
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role        text not null default 'admin' check (role in ('admin','editor','viewer')),
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- contacts: the people we email.
-- -----------------------------------------------------------------------------
create table if not exists public.contacts (
  id                 uuid primary key default gen_random_uuid(),
  email              citext not null unique,
  first_name         text,
  last_name          text,
  phone              text,
  source             text,                         -- e.g. 'zoom', 'manual', 'website'
  registered_at      timestamptz,                  -- when they registered (from source)
  subscribed         boolean not null default true,
  unsubscribe_token  uuid not null default gen_random_uuid(),
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists contacts_subscribed_idx on public.contacts (subscribed);
create index if not exists contacts_source_idx     on public.contacts (source);
create index if not exists contacts_created_at_idx on public.contacts (created_at desc);

-- -----------------------------------------------------------------------------
-- lists: named collections of contacts.
-- -----------------------------------------------------------------------------
create table if not exists public.lists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  owner_id    uuid references auth.users(id) on delete set null
);
create unique index if not exists lists_name_uidx on public.lists (lower(name));

-- list <-> contact many-to-many
create table if not exists public.list_contacts (
  list_id    uuid not null references public.lists(id)    on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (list_id, contact_id)
);
create index if not exists list_contacts_contact_idx on public.list_contacts (contact_id);

-- -----------------------------------------------------------------------------
-- campaigns: an email being drafted / scheduled / sent.
-- -----------------------------------------------------------------------------
create table if not exists public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                        -- internal label
  subject       text,
  preview_text  text,                                 -- inbox preview
  from_name     text not null default 'Addie Agarwal',
  from_email    text not null default 'addie@blog.ignoraint.com',
  reply_to      text,
  body_html     text,                                 -- rendered HTML
  body_text     text,                                 -- plain text fallback
  list_id       uuid references public.lists(id) on delete set null,
  status        text not null default 'draft' check (status in ('draft','sending','sent','failed','scheduled')),
  scheduled_at  timestamptz,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null
);
create index if not exists campaigns_status_idx     on public.campaigns (status);
create index if not exists campaigns_created_at_idx on public.campaigns (created_at desc);

-- -----------------------------------------------------------------------------
-- campaign_sends: one row per (campaign, contact) send attempt.
-- -----------------------------------------------------------------------------
create table if not exists public.campaign_sends (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null references public.campaigns(id) on delete cascade,
  contact_id          uuid not null references public.contacts(id)  on delete cascade,
  status              text not null default 'pending' check (status in ('pending','sent','failed','bounced','skipped')),
  provider_message_id text,                          -- Resend message id
  error               text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
create index if not exists campaign_sends_campaign_idx on public.campaign_sends (campaign_id);
create index if not exists campaign_sends_contact_idx  on public.campaign_sends (contact_id);

-- -----------------------------------------------------------------------------
-- email_drafts: AI-generated draft versions, kept for history.
-- -----------------------------------------------------------------------------
create table if not exists public.email_drafts (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid references public.campaigns(id) on delete cascade,
  prompt       text,
  subject      text,
  body_html    text,
  body_text    text,
  model        text,                                 -- e.g. 'claude-sonnet-4-6'
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null
);
create index if not exists email_drafts_campaign_idx on public.email_drafts (campaign_id);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists contacts_touch on public.contacts;
create trigger contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();

drop trigger if exists lists_touch on public.lists;
create trigger lists_touch before update on public.lists
  for each row execute function public.touch_updated_at();

drop trigger if exists campaigns_touch on public.campaigns;
create trigger campaigns_touch before update on public.campaigns
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Helper: count subscribed contacts on a list.
-- -----------------------------------------------------------------------------
create or replace function public.list_subscribed_count(p_list_id uuid)
returns integer language sql stable as $$
  select count(*)::int
  from public.list_contacts lc
  join public.contacts c on c.id = lc.contact_id
  where lc.list_id = p_list_id and c.subscribed = true;
$$;

-- -----------------------------------------------------------------------------
-- Helper: admin check based on profiles table.
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','editor','viewer')
  );
$$;

-- -----------------------------------------------------------------------------
-- Row-Level Security — lock everything to authenticated admins.
-- The anon key cannot read/write. Unauthenticated users hit the edge functions
-- which use the service_role key internally.
-- -----------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.contacts       enable row level security;
alter table public.lists          enable row level security;
alter table public.list_contacts  enable row level security;
alter table public.campaigns      enable row level security;
alter table public.campaign_sends enable row level security;
alter table public.email_drafts   enable row level security;

-- profiles: each user can read their own row; admins can read all
drop policy if exists "profile self read"      on public.profiles;
drop policy if exists "profile self update"    on public.profiles;
create policy "profile self read"   on public.profiles for select using (auth.uid() = id or public.is_admin());
create policy "profile self update" on public.profiles for update using (auth.uid() = id);

-- All admin tables: full access for rows while logged in as a profile-listed user
do $$
declare t text;
begin
  foreach t in array array['contacts','lists','list_contacts','campaigns','campaign_sends','email_drafts']
  loop
    execute format('drop policy if exists "admin all %I" on public.%I;', t, t);
    execute format('create policy "admin all %I" on public.%I for all using (public.is_admin()) with check (public.is_admin());', t, t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Seed: auto-create a profile row whenever a new auth.user is created.
-- You still must insert the user via Supabase Auth (dashboard or API).
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email), 'admin')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Convenience view used by the UI dashboard.
-- -----------------------------------------------------------------------------
create or replace view public.campaign_summary as
select
  c.id,
  c.name,
  c.subject,
  c.status,
  c.list_id,
  l.name as list_name,
  c.scheduled_at,
  c.sent_at,
  c.created_at,
  (select count(*) from public.campaign_sends s where s.campaign_id = c.id and s.status = 'sent')     as sent_count,
  (select count(*) from public.campaign_sends s where s.campaign_id = c.id and s.status = 'failed')   as failed_count,
  (select count(*) from public.campaign_sends s where s.campaign_id = c.id and s.status = 'pending')  as pending_count
from public.campaigns c
left join public.lists l on l.id = c.list_id;
