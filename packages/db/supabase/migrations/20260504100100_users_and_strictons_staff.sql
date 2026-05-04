-- ============================================================================
-- Cluster A — auth & users
-- ----------------------------------------------------------------------------
-- public.users         profile extension of auth.users, populated by trigger
-- public.strictons_staff   flat staff table backing is_strictons_staff()
-- ============================================================================

-- ---- public.users ----------------------------------------------------------

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function extensions.moddatetime(updated_at);

-- Mirror auth.users into public.users on signup. Magic-link sign-in creates
-- the auth.users row; this trigger keeps the public profile in lockstep.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---- public.strictons_staff ------------------------------------------------

create table public.strictons_staff (
  user_id uuid primary key references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---- is_strictons_staff() helper -------------------------------------------
-- security definer so the function can read strictons_staff regardless of
-- the caller's role. Without this, a non-staff caller's own RLS-filtered
-- view of strictons_staff would always be empty, making the check unusable
-- inside other policies that want to grant staff broad access.
create or replace function public.is_strictons_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.strictons_staff
    where user_id = auth.uid()
  );
$$;
comment on function public.is_strictons_staff() is
  'True if the calling auth.uid() is a row in public.strictons_staff. Used as the staff-bypass predicate in every other table''s RLS policies.';

-- ---- RLS: public.users -----------------------------------------------------

alter table public.users enable row level security;

-- Authenticated users may read their own profile.
create policy "users_select_own"
  on public.users for select to authenticated
  using (id = auth.uid());

-- Strictons staff may read every profile.
create policy "users_select_strictons"
  on public.users for select to authenticated
  using (public.is_strictons_staff());

-- Authenticated users may update only display_name on their own row.
-- Column-level GRANT prevents email or id from being changed via UPDATE.
revoke update on public.users from authenticated;
grant update (display_name) on public.users to authenticated;

create policy "users_update_own_display_name"
  on public.users for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Strictons staff may update any profile (administrative correction).
create policy "users_update_strictons"
  on public.users for update to authenticated
  using (public.is_strictons_staff())
  with check (public.is_strictons_staff());

-- INSERT and DELETE on public.users are not exposed to authenticated users.
-- INSERTs happen via the on_auth_user_created trigger (security definer);
-- DELETEs cascade from auth.users deletion.
-- (No policy = denied for authenticated; service role bypasses RLS.)

-- ---- RLS: public.strictons_staff -------------------------------------------

alter table public.strictons_staff enable row level security;

-- Only Strictons staff may see the staff list. Self-membership check still
-- works because is_strictons_staff() runs with security definer.
create policy "strictons_staff_select_self"
  on public.strictons_staff for select to authenticated
  using (public.is_strictons_staff());

-- INSERT/UPDATE/DELETE on strictons_staff are intentionally not addressable
-- via RLS for any non-service role. Adding/removing staff happens via
-- service-role-bound admin tooling so the permission gate cannot be raised
-- from inside the application surface.
