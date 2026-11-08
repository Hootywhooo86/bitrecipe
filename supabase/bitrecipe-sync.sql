-- bitrecipe sync: recipes, grocery list and profile (XP, badges, settings) on every device.
-- Run once in Supabase → "128bit play" project → SQL Editor → paste → Run (safe to run again).
-- Each account can only see and change its own rows (same account_sub() as bitcalendar).
create table if not exists public.bitrecipe_items (
  user_id text not null default public.account_sub(),
  kind text not null check (kind in ('recipe', 'grocery', 'profile')),
  id text not null check (length(id) between 1 and 200),
  data jsonb,
  deleted boolean not null default false,
  modified bigint not null default 0,            -- when the device changed it (ms since 1970)
  updated_at timestamptz not null default now(), -- when the server got it: devices pull by this
  primary key (user_id, kind, id),
  constraint bitrecipe_items_size check (pg_column_size(data) < 400000)
);
create index if not exists bitrecipe_items_changes on public.bitrecipe_items (user_id, updated_at);
alter table public.bitrecipe_items enable row level security;

drop policy if exists own on public.bitrecipe_items;
create policy own on public.bitrecipe_items for all to authenticated
  using (user_id = (select public.account_sub()))
  with check (user_id = (select public.account_sub()));

-- The server clock decides pull order, so a phone with the wrong time can't hide changes.
create or replace function public.bitrecipe_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists bitrecipe_stamp on public.bitrecipe_items;
create trigger bitrecipe_stamp before insert or update on public.bitrecipe_items
  for each row execute function public.bitrecipe_stamp();

-- Push changes; an older edit never overwrites a newer one from another device.
create or replace function public.bitrecipe_push(items jsonb) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  if public.account_sub() is null then raise exception 'Sign in first'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 200 then
    raise exception 'Send a list of at most 200 items';
  end if;
  insert into bitrecipe_items (user_id, kind, id, data, deleted, modified)
  select public.account_sub(), e ->> 'kind', e ->> 'id',
         case when coalesce((e ->> 'deleted')::boolean, false) then null else e -> 'data' end,
         coalesce((e ->> 'deleted')::boolean, false), coalesce((e ->> 'modified')::bigint, 0)
    from jsonb_array_elements(items) e
  on conflict (user_id, kind, id) do update
    set data = excluded.data, deleted = excluded.deleted, modified = excluded.modified
    where bitrecipe_items.modified <= excluded.modified;
  get diagnostics n = row_count;
  return n;
end $$;

-- Settings › Remove my bitrecipe data from the server.
create or replace function public.bitrecipe_wipe() returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  delete from bitrecipe_items where user_id = public.account_sub();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.bitrecipe_push(jsonb), public.bitrecipe_wipe(), public.bitrecipe_stamp() from public, anon;
grant execute on function public.bitrecipe_push(jsonb), public.bitrecipe_wipe() to authenticated;
revoke all on table public.bitrecipe_items from anon;
grant select, insert, update, delete on table public.bitrecipe_items to authenticated;
