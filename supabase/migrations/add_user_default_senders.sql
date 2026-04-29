-- -----------------------------------------------------------------------------
-- add_user_default_senders.sql
--
-- Per-user default sender fields. Previously these lived only in the browser's
-- localStorage, which Safari ITP wipes after 7 days of no interaction and which
-- doesn't sync across devices — so "Set as default" appeared not to stick.
--
-- These columns are populated by the CRM's "Set as default" button on the
-- campaign editor and read at new-campaign creation. The CRM code falls back
-- through DB → localStorage → config.js, so it works either way.
--
-- Re-running this file is safe.
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists default_from_name  text,
  add column if not exists default_from_email text,
  add column if not exists default_reply_to   text;

-- Allow a user to read their own profile defaults
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_self_select'
  ) then
    create policy profiles_self_select on public.profiles
      for select using (auth.uid() = id);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_self_update'
  ) then
    create policy profiles_self_update on public.profiles
      for update using (auth.uid() = id) with check (auth.uid() = id);
  end if;
end $$;

-- Make sure RLS is on (no-op if already on)
alter table public.profiles enable row level security;
