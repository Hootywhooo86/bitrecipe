-- bitrecipe AI chef: a per-account daily limit so the Claude bill stays small.
-- Run once in Supabase → "128bit play" project → SQL Editor (safe to run again).
create table if not exists public.bitrecipe_ai_usage (
  user_id text not null default public.account_sub(),
  day date not null default (now() at time zone 'utc')::date,
  used int not null default 0,
  primary key (user_id, day)
);
alter table public.bitrecipe_ai_usage enable row level security;
drop policy if exists own_read on public.bitrecipe_ai_usage;
create policy own_read on public.bitrecipe_ai_usage for select to authenticated using (user_id = (select public.account_sub()));

-- Uses one AI recipe for today; returns how many are left, or fails at the limit.
create or replace function public.bitrecipe_ai_take(daily_limit int default 25) returns int
language plpgsql security definer set search_path = public as $$
declare me text := public.account_sub(); n int;
begin
  if me is null then raise exception 'Sign in first'; end if;
  insert into bitrecipe_ai_usage (user_id, day, used) values (me, (now() at time zone 'utc')::date, 1)
    on conflict (user_id, day) do update set used = bitrecipe_ai_usage.used + 1
    returning used into n;
  if n > least(greatest(daily_limit, 1), 200) then raise exception 'Daily AI limit reached'; end if;
  return least(greatest(daily_limit, 1), 200) - n;
end $$;

revoke all on function public.bitrecipe_ai_take(int) from public, anon;
grant execute on function public.bitrecipe_ai_take(int) to authenticated;
revoke all on table public.bitrecipe_ai_usage from anon;
grant select on table public.bitrecipe_ai_usage to authenticated;

-- Gives back one AI recipe for today when the AI failed to make one,
-- so only recipes that actually arrive count against the limit.
create or replace function public.bitrecipe_ai_give_back() returns int
language plpgsql security definer set search_path = public as $$
declare me text := public.account_sub(); n int;
begin
  if me is null then raise exception 'Sign in first'; end if;
  update bitrecipe_ai_usage set used = greatest(used - 1, 0)
    where user_id = me and day = (now() at time zone 'utc')::date
    returning used into n;
  return coalesce(n, 0);
end $$;

revoke all on function public.bitrecipe_ai_give_back() from public, anon;
grant execute on function public.bitrecipe_ai_give_back() to authenticated;
