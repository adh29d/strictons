-- ============================================================================
-- Cluster C — businesses, business_users
-- ----------------------------------------------------------------------------
-- The hotel_user → businesses-via-ad_placements visibility policy is added
-- in the next migration alongside ad_placements (the join target).
-- ============================================================================

-- ---- public.businesses -----------------------------------------------------

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (length(trim(legal_name)) > 0),
  display_name text not null check (length(trim(display_name)) > 0),
  website text,
  phone text,
  address text,
  social_handles jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Schema gate on social_handles: keys must be from a known set; values
  -- must be strings. Application-level validation is the primary guard,
  -- this is belt-and-braces for direct DB writes.
  check (
    jsonb_typeof(social_handles) = 'object'
    and (
      select bool_and(
        key in ('instagram', 'facebook', 'tiktok', 'other')
        and jsonb_typeof(value) = 'string'
      )
      from jsonb_each(social_handles)
    )
  )
);

create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function extensions.moddatetime(updated_at);

-- ---- public.business_users -------------------------------------------------

create table public.business_users (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  invited_email citext not null,
  is_admin boolean not null default false,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),

  unique (business_id, invited_email)
);

create index business_users_business_idx on public.business_users (business_id);
create index business_users_user_idx on public.business_users (user_id) where user_id is not null;

-- First invitee per business auto-promoted to admin (symmetric to hotel_users).
create trigger business_users_first_invitee_admin
  before insert on public.business_users
  for each row execute function public.set_first_invitee_admin('business_id');

-- ---- Membership helpers ----------------------------------------------------

create or replace function public.is_business_user(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.business_users
    where business_id = p_business_id
      and user_id = auth.uid()
      and accepted_at is not null
  );
$$;
comment on function public.is_business_user(uuid) is
  'True if auth.uid() is an accepted member of the given business.';

create or replace function public.is_business_admin(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.business_users
    where business_id = p_business_id
      and user_id = auth.uid()
      and accepted_at is not null
      and is_admin = true
  );
$$;
comment on function public.is_business_admin(uuid) is
  'True if auth.uid() is an accepted admin of the given business.';

-- ---- RLS: businesses -------------------------------------------------------

alter table public.businesses enable row level security;

create policy "businesses_select_member"
  on public.businesses for select to authenticated
  using (public.is_business_user(id));

create policy "businesses_select_strictons"
  on public.businesses for select to authenticated
  using (public.is_strictons_staff());

-- Business admin may update the listing-editable fields.
-- Strictons-side mutation (legal_name corrections, etc.) goes via service role.
revoke update on public.businesses from authenticated;
grant update (display_name, website, phone, address, social_handles)
  on public.businesses to authenticated;

create policy "businesses_update_admin"
  on public.businesses for update to authenticated
  using (public.is_business_admin(id))
  with check (public.is_business_admin(id));

-- INSERT/DELETE not exposed to authenticated; service role only.

-- ---- RLS: business_users ---------------------------------------------------

alter table public.business_users enable row level security;

create policy "business_users_select_self_business"
  on public.business_users for select to authenticated
  using (public.is_business_user(business_id));

create policy "business_users_select_strictons"
  on public.business_users for select to authenticated
  using (public.is_strictons_staff());

create policy "business_users_insert_admin"
  on public.business_users for insert to authenticated
  with check (public.is_business_admin(business_id));

create policy "business_users_insert_strictons"
  on public.business_users for insert to authenticated
  with check (public.is_strictons_staff());

create policy "business_users_delete_admin"
  on public.business_users for delete to authenticated
  using (public.is_business_admin(business_id));

create policy "business_users_delete_strictons"
  on public.business_users for delete to authenticated
  using (public.is_strictons_staff());

create policy "business_users_update_self_accept"
  on public.business_users for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "business_users_update_strictons"
  on public.business_users for update to authenticated
  using (public.is_strictons_staff())
  with check (public.is_strictons_staff());
