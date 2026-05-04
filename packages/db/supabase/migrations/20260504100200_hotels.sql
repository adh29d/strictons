-- ============================================================================
-- Cluster B — hotels, hotel_users, guides, print_change_requests
-- ============================================================================

-- btree_gist powers the no-overlap exclusion constraint on guides per hotel.
create extension if not exists btree_gist with schema extensions;

-- ---- public.hotels ---------------------------------------------------------

create table public.hotels (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique check (public.is_url_safe_slug(slug)),
  name text not null check (length(trim(name)) > 0),
  custom_domain citext unique,
  contact_email citext not null,

  design_meeting_at timestamptz,
  approval_state public.hotel_approval_state not null default 'pending_design_meeting',

  candidate_list_approval_due_at timestamptz,
  candidate_list_approved_at timestamptz,
  final_guide_approval_due_at timestamptz,
  final_guide_approved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger hotels_set_updated_at
  before update on public.hotels
  for each row execute function extensions.moddatetime(updated_at);

-- Slug is immutable once set. Changing it would break QR target URLs and
-- mystay.au routing.
create or replace function public.enforce_hotel_slug_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'hotels.slug is immutable; cannot change from % to %', old.slug, new.slug;
end;
$$;

create trigger hotels_slug_immutable
  before update on public.hotels
  for each row
  when (new.slug is distinct from old.slug)
  execute function public.enforce_hotel_slug_immutable();

-- ---- public.hotel_users ----------------------------------------------------

create table public.hotel_users (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  invited_email citext not null,
  is_admin boolean not null default false,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),

  unique (hotel_id, invited_email)
);

create index hotel_users_hotel_idx on public.hotel_users (hotel_id);
create index hotel_users_user_idx on public.hotel_users (user_id) where user_id is not null;

-- First invitee per hotel auto-promoted to admin regardless of caller input.
create trigger hotel_users_first_invitee_admin
  before insert on public.hotel_users
  for each row execute function public.set_first_invitee_admin('hotel_id');

-- ---- public.guides ---------------------------------------------------------

create table public.guides (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete restrict,
  term_starts_on date not null,
  term_ends_on date not null,
  status public.guide_status not null default 'design',
  printed_at timestamptz,
  print_run_count int not null default 0 check (print_run_count >= 0),
  mid_term_change_window_opens_on date,
  mid_term_change_window_closes_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (term_ends_on > term_starts_on),
  check (
    mid_term_change_window_opens_on is null
    or (
      mid_term_change_window_opens_on >= term_starts_on
      and mid_term_change_window_closes_on > mid_term_change_window_opens_on
      and mid_term_change_window_closes_on <= term_ends_on
    )
  ),

  -- No two guides for the same hotel may have overlapping term ranges.
  -- daterange treated [] inclusive on both ends.
  exclude using gist (
    hotel_id with =,
    daterange(term_starts_on, term_ends_on, '[]') with &&
  )
);

create trigger guides_set_updated_at
  before update on public.guides
  for each row execute function extensions.moddatetime(updated_at);

create index guides_hotel_idx on public.guides (hotel_id);

-- ---- public.print_change_requests ------------------------------------------

create table public.print_change_requests (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.guides(id) on delete cascade,
  requested_by_user_id uuid references public.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  applied_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index print_change_requests_guide_idx on public.print_change_requests (guide_id);

-- ---- Membership helper functions -------------------------------------------
-- security definer + tightly scoped; called from RLS policies on every table
-- that scopes by hotel.

create or replace function public.is_hotel_user(p_hotel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.hotel_users
    where hotel_id = p_hotel_id
      and user_id = auth.uid()
      and accepted_at is not null
  );
$$;
comment on function public.is_hotel_user(uuid) is
  'True if auth.uid() is an accepted member of the given hotel.';

create or replace function public.is_hotel_admin(p_hotel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.hotel_users
    where hotel_id = p_hotel_id
      and user_id = auth.uid()
      and accepted_at is not null
      and is_admin = true
  );
$$;
comment on function public.is_hotel_admin(uuid) is
  'True if auth.uid() is an accepted admin of the given hotel.';

-- ---- RLS: hotels -----------------------------------------------------------

alter table public.hotels enable row level security;

create policy "hotels_select_member"
  on public.hotels for select to authenticated
  using (public.is_hotel_user(id));

create policy "hotels_select_strictons"
  on public.hotels for select to authenticated
  using (public.is_strictons_staff());

-- Hotel admin may update only contact_email. Column-level GRANT enforces.
-- Strictons staff updates to all other fields (approval_state, due dates,
-- name, custom_domain, etc.) go via the service-role client server-side and
-- bypass RLS / column GRANTs entirely. We intentionally do NOT add a
-- broader UPDATE GRANT for authenticated here, because it would dissolve
-- the column-level restriction for hotel_admin.
revoke update on public.hotels from authenticated;
grant update (contact_email) on public.hotels to authenticated;

create policy "hotels_update_admin_contact_email"
  on public.hotels for update to authenticated
  using (public.is_hotel_admin(id))
  with check (public.is_hotel_admin(id));

-- INSERT/DELETE not exposed to authenticated; service role bypasses RLS.

-- ---- RLS: hotel_users ------------------------------------------------------

alter table public.hotel_users enable row level security;

create policy "hotel_users_select_self_hotel"
  on public.hotel_users for select to authenticated
  using (public.is_hotel_user(hotel_id));

create policy "hotel_users_select_strictons"
  on public.hotel_users for select to authenticated
  using (public.is_strictons_staff());

create policy "hotel_users_insert_admin"
  on public.hotel_users for insert to authenticated
  with check (public.is_hotel_admin(hotel_id));

create policy "hotel_users_insert_strictons"
  on public.hotel_users for insert to authenticated
  with check (public.is_strictons_staff());

create policy "hotel_users_delete_admin"
  on public.hotel_users for delete to authenticated
  using (public.is_hotel_admin(hotel_id));

create policy "hotel_users_delete_strictons"
  on public.hotel_users for delete to authenticated
  using (public.is_strictons_staff());

-- Self may set accepted_at on first sign-in.
create policy "hotel_users_update_self_accept"
  on public.hotel_users for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "hotel_users_update_strictons"
  on public.hotel_users for update to authenticated
  using (public.is_strictons_staff())
  with check (public.is_strictons_staff());

-- ---- RLS: guides -----------------------------------------------------------

alter table public.guides enable row level security;

create policy "guides_select_member"
  on public.guides for select to authenticated
  using (public.is_hotel_user(hotel_id));

create policy "guides_select_strictons"
  on public.guides for select to authenticated
  using (public.is_strictons_staff());

-- Guides are only created/edited/deleted by Strictons (contract artefact).
create policy "guides_write_strictons"
  on public.guides for all to authenticated
  using (public.is_strictons_staff())
  with check (public.is_strictons_staff());

-- ---- RLS: print_change_requests --------------------------------------------

alter table public.print_change_requests enable row level security;

create policy "print_change_requests_select_admin"
  on public.print_change_requests for select to authenticated
  using (
    exists (
      select 1 from public.guides g
      where g.id = print_change_requests.guide_id
        and public.is_hotel_admin(g.hotel_id)
    )
  );

create policy "print_change_requests_select_strictons"
  on public.print_change_requests for select to authenticated
  using (public.is_strictons_staff());

-- Hotel admin may request a change while their guide is in the eligible window.
create policy "print_change_requests_insert_admin"
  on public.print_change_requests for insert to authenticated
  with check (
    exists (
      select 1 from public.guides g
      where g.id = print_change_requests.guide_id
        and public.is_hotel_admin(g.hotel_id)
        and current_date >= coalesce(g.mid_term_change_window_opens_on, current_date + 1)
        and current_date <= coalesce(g.mid_term_change_window_closes_on, current_date - 1)
    )
  );

create policy "print_change_requests_write_strictons"
  on public.print_change_requests for all to authenticated
  using (public.is_strictons_staff())
  with check (public.is_strictons_staff());
