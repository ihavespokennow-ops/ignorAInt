-- add_multi_list_and_merge.sql
-- ---------------------------------------------------------------------------
-- Adds multi-list sending (campaigns.list_ids) + an atomic merge_lists RPC.
-- Backward compatible: existing campaigns.list_id keeps working; when a
-- campaign uses list_ids the UI/edge function prefer it. When both exist,
-- list_ids wins.
-- ---------------------------------------------------------------------------

-- 1) Multi-list column on campaigns.
alter table public.campaigns
  add column if not exists list_ids uuid[] not null default '{}';

-- GIN index so "campaigns that reference list X" stays fast even for large tables.
create index if not exists campaigns_list_ids_gin
  on public.campaigns using gin (list_ids);

-- 2) Distinct-subscribed count across any set of lists (for the send modal).
create or replace function public.list_subscribed_count_multi(p_list_ids uuid[])
returns bigint
language sql
stable
as $$
  select count(distinct c.id)
  from public.contacts c
  join public.list_contacts lc on lc.contact_id = c.id
  where lc.list_id = any(p_list_ids)
    and c.subscribed = true;
$$;

-- 3) Atomic list merge: copy all members of source into destination, then
-- delete the source list. Wrapped in a single transaction so we can't end up
-- with a half-merged state if the delete fails.
create or replace function public.merge_lists(p_source uuid, p_dest uuid)
returns table(moved integer, already_in_dest integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moved integer := 0;
  v_already integer := 0;
begin
  if p_source = p_dest then
    raise exception 'Source and destination must be different lists';
  end if;
  if not exists (select 1 from public.lists where id = p_source) then
    raise exception 'Source list not found';
  end if;
  if not exists (select 1 from public.lists where id = p_dest) then
    raise exception 'Destination list not found';
  end if;

  -- How many source members are already in the destination (for reporting).
  select count(*) into v_already
  from public.list_contacts s
  where s.list_id = p_source
    and exists (
      select 1 from public.list_contacts d
      where d.list_id = p_dest and d.contact_id = s.contact_id
    );

  -- Copy everyone from source into destination; ON CONFLICT handles dedup.
  with copied as (
    insert into public.list_contacts (list_id, contact_id, added_at)
    select p_dest, s.contact_id, now()
    from public.list_contacts s
    where s.list_id = p_source
    on conflict (list_id, contact_id) do nothing
    returning 1
  )
  select count(*) into v_moved from copied;

  -- Update any campaigns that referenced the source list so they don't break.
  update public.campaigns
     set list_id = p_dest
   where list_id = p_source;

  update public.campaigns
     set list_ids = array(
       select distinct unnest(
         array_replace(list_ids, p_source, p_dest)
       )
     )
   where list_ids @> array[p_source];

  -- Delete the source list (cascade removes list_contacts rows for it).
  delete from public.lists where id = p_source;

  return query select v_moved, v_already;
end;
$$;

-- 4) Rebuild campaign_summary so the Campaigns table shows a friendly list
-- label when multi-list is used. (Drop + recreate because we're inserting a
-- new column and Postgres won't allow that via CREATE OR REPLACE VIEW.)
drop view if exists public.campaign_summary cascade;
create view public.campaign_summary as
select
  c.id,
  c.name,
  c.subject,
  c.status,
  c.list_id,
  c.list_ids,
  case
    when coalesce(array_length(c.list_ids, 1), 0) > 1
      then array_length(c.list_ids, 1)::text || ' lists'
    when coalesce(array_length(c.list_ids, 1), 0) = 1
      then (select name from public.lists where id = c.list_ids[1])
    else l.name
  end as list_name,
  c.scheduled_at,
  c.sent_at,
  c.created_at,
  (select count(*) from public.campaign_sends s where s.campaign_id = c.id and s.status = 'sent')    as sent_count,
  (select count(*) from public.campaign_sends s where s.campaign_id = c.id and s.status = 'failed')  as failed_count,
  (select count(*) from public.campaign_sends s where s.campaign_id = c.id and s.status = 'pending') as pending_count
from public.campaigns c
left join public.lists l on l.id = c.list_id;
