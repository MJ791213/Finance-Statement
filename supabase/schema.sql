-- Statement Categorizer: one encrypted workspace per user.
-- Run once in Supabase → SQL Editor → New query → Run.
--
-- The page encrypts the workspace in the browser (AES-GCM, key derived from the
-- user's password), so this table only ever holds ciphertext. Row-level
-- security makes the database itself refuse to return or change any row that
-- does not belong to the signed-in user.

create table if not exists public.workspaces (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  salt       text not null,
  iv         text not null,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;

-- Nobody who is not signed in can touch the table at all.
revoke all on public.workspaces from anon;
revoke all on public.workspaces from public;
grant select, insert, update, delete on public.workspaces to authenticated;

drop policy if exists "own workspace: read"   on public.workspaces;
drop policy if exists "own workspace: insert" on public.workspaces;
drop policy if exists "own workspace: update" on public.workspaces;
drop policy if exists "own workspace: delete" on public.workspaces;

create policy "own workspace: read" on public.workspaces
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own workspace: insert" on public.workspaces
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own workspace: update" on public.workspaces
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own workspace: delete" on public.workspaces
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Keep updated_at current on every save.
create or replace function public.workspaces_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists workspaces_touch on public.workspaces;
create trigger workspaces_touch before update on public.workspaces
  for each row execute function public.workspaces_touch();
