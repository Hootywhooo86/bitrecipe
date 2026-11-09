-- bitrecipe family cookbooks: a shared recipe book people join with a 6-letter code.
-- Run once in Supabase → "128bit play" project → SQL Editor (safe to run again).
-- Needs bitrecipe-sync.sql first (same account_sub()).
create table if not exists public.bitrecipe_books (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  code text not null unique,
  owner text not null default public.account_sub(),
  created_at timestamptz not null default now()
);
create table if not exists public.bitrecipe_book_members (
  book_id uuid not null references public.bitrecipe_books on delete cascade,
  user_id text not null default public.account_sub(),
  name text not null default '',
  joined_at timestamptz not null default now(),
  primary key (book_id, user_id)
);
create table if not exists public.bitrecipe_book_recipes (
  book_id uuid not null references public.bitrecipe_books on delete cascade,
  id text not null check (length(id) between 1 and 200),
  data jsonb,
  deleted boolean not null default false,
  added_by text not null default public.account_sub(),
  added_name text not null default '',
  modified bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (book_id, id),
  constraint bitrecipe_book_recipes_size check (pg_column_size(data) < 400000)
);
create index if not exists bitrecipe_book_recipes_changes on public.bitrecipe_book_recipes (book_id, updated_at);

-- Is the signed-in account in this book? (definer, so policies don't recurse)
create or replace function public.bitrecipe_in_book(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from bitrecipe_book_members where book_id = b and user_id = public.account_sub())
$$;

alter table public.bitrecipe_books enable row level security;
alter table public.bitrecipe_book_members enable row level security;
alter table public.bitrecipe_book_recipes enable row level security;
drop policy if exists members_read on public.bitrecipe_books;
create policy members_read on public.bitrecipe_books for select to authenticated using (public.bitrecipe_in_book(id));
drop policy if exists members_read on public.bitrecipe_book_members;
create policy members_read on public.bitrecipe_book_members for select to authenticated using (public.bitrecipe_in_book(book_id));
drop policy if exists members_all on public.bitrecipe_book_recipes;
create policy members_all on public.bitrecipe_book_recipes for all to authenticated
  using (public.bitrecipe_in_book(book_id)) with check (public.bitrecipe_in_book(book_id));

drop trigger if exists bitrecipe_stamp on public.bitrecipe_book_recipes;
create trigger bitrecipe_stamp before insert or update on public.bitrecipe_book_recipes
  for each row execute function public.bitrecipe_stamp();

-- New book; you're its first member. Returns {id, name, code}.
create or replace function public.bitrecipe_create_book(book_name text, my_name text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bitrecipe_books; c text;
begin
  if public.account_sub() is null then raise exception 'Sign in first'; end if;
  loop
    c := '';
    for i in 1..6 loop  -- no 0/O/1/I/L so codes are easy to read out
      c := c || substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1);
    end loop;
    exit when not exists (select 1 from bitrecipe_books where code = c);
  end loop;
  insert into bitrecipe_books (name, code) values (left(coalesce(nullif(trim(book_name), ''), 'Family cookbook'), 60), c) returning * into b;
  insert into bitrecipe_book_members (book_id, name) values (b.id, left(coalesce(my_name, ''), 40));
  return jsonb_build_object('id', b.id, 'name', b.name, 'code', b.code);
end $$;

-- Join with a code. Returns {id, name, code}.
create or replace function public.bitrecipe_join_book(book_code text, my_name text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bitrecipe_books;
begin
  if public.account_sub() is null then raise exception 'Sign in first'; end if;
  select * into b from bitrecipe_books where code = upper(trim(book_code));
  if b.id is null then raise exception 'No cookbook has that code'; end if;
  insert into bitrecipe_book_members (book_id, name) values (b.id, left(coalesce(my_name, ''), 40))
    on conflict (book_id, user_id) do update set name = excluded.name;
  return jsonb_build_object('id', b.id, 'name', b.name, 'code', b.code);
end $$;

-- Leave; the last one out deletes the book.
create or replace function public.bitrecipe_leave_book(b uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from bitrecipe_book_members where book_id = b and user_id = public.account_sub();
  if not exists (select 1 from bitrecipe_book_members where book_id = b) then delete from bitrecipe_books where id = b; end if;
end $$;

-- Add / update / remove recipes in a book (newest edit wins).
create or replace function public.bitrecipe_book_push(b uuid, items jsonb, my_name text default '') returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  if not public.bitrecipe_in_book(b) then raise exception 'You are not in that cookbook'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 100 then raise exception 'Send at most 100 recipes'; end if;
  insert into bitrecipe_book_recipes (book_id, id, data, deleted, added_name, modified)
  select b, e ->> 'id', case when coalesce((e ->> 'deleted')::boolean, false) then null else e -> 'data' end,
         coalesce((e ->> 'deleted')::boolean, false), left(coalesce(my_name, ''), 40), coalesce((e ->> 'modified')::bigint, 0)
    from jsonb_array_elements(items) e
  on conflict (book_id, id) do update
    set data = excluded.data, deleted = excluded.deleted, modified = excluded.modified,
        added_name = case when excluded.deleted then bitrecipe_book_recipes.added_name else excluded.added_name end
    where bitrecipe_book_recipes.modified <= excluded.modified;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.bitrecipe_in_book(uuid), public.bitrecipe_create_book(text, text), public.bitrecipe_join_book(text, text),
  public.bitrecipe_leave_book(uuid), public.bitrecipe_book_push(uuid, jsonb, text) from public, anon;
grant execute on function public.bitrecipe_in_book(uuid), public.bitrecipe_create_book(text, text), public.bitrecipe_join_book(text, text),
  public.bitrecipe_leave_book(uuid), public.bitrecipe_book_push(uuid, jsonb, text) to authenticated;
revoke all on table public.bitrecipe_books, public.bitrecipe_book_members, public.bitrecipe_book_recipes from anon;
grant select on table public.bitrecipe_books, public.bitrecipe_book_members to authenticated;
grant select, insert, update, delete on table public.bitrecipe_book_recipes to authenticated;
