-- ============================================================================
-- Cluster E — candidate_businesses
-- ----------------------------------------------------------------------------
-- The curated list of nearby businesses Strictons proposes to the hotel.
-- Once a hotel_admin approves and a business signs, Strictons (only) sets
-- status='signed_to_placement' and records the linked_business_id.
-- ============================================================================

create table public.candidate_businesses (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,

  source public.candidate_source not null,
  google_place_id text,
  name text not null check (length(trim(name)) > 0),
  address text,
  category text,
  distance_m int check (distance_m is null or distance_m >= 0),

  status public.candidate_status not null default 'proposed',

  proposed_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_user_id uuid references public.users(id) on delete set null,

  linked_business_id uuid references public.businesses(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- linked_business_id is set iff status='signed_to_placement'.
  check (
    (status = 'signed_to_placement' and linked_business_id is not null)
    or (status <> 'signed_to_placement' and linked_business_id is null)
  ),
  -- google_place_id required when source='google_places'.
  check (
    (source = 'google_places' and google_place_id is not null)
    or (source <> 'google_places')
  )
);

create trigger candidate_businesses_set_updated_at
  before update on public.candidate_businesses
  for each row execute function extensions.moddatetime(updated_at);

create index candidate_businesses_hotel_idx on public.candidate_businesses (hotel_id);
create index candidate_businesses_google_place_idx
  on public.candidate_businesses (google_place_id)
  where google_place_id is not null;

-- ---- RLS -------------------------------------------------------------------

alter table public.candidate_businesses enable row level security;

create policy "candidate_businesses_select_hotel"
  on public.candidate_businesses for select to authenticated
  using (public.is_hotel_user(hotel_id));

create policy "candidate_businesses_select_strictons"
  on public.candidate_businesses for select to authenticated
  using (public.is_strictons_staff());

-- INSERT: Strictons only — the candidate list is Strictons-curated.
create policy "candidate_businesses_insert_strictons"
  on public.candidate_businesses for insert to authenticated
  with check (public.is_strictons_staff());

-- Hotel admin can decide on candidates: status -> approved | removed_by_hotel.
-- Cannot transition to signed_to_placement (Strictons-only).
-- Column-level GRANT restricts what they can change.
revoke update on public.candidate_businesses from authenticated;
grant update (status, decided_at, decided_by_user_id)
  on public.candidate_businesses to authenticated;

create policy "candidate_businesses_update_hotel_admin"
  on public.candidate_businesses for update to authenticated
  using (public.is_hotel_admin(hotel_id))
  with check (
    public.is_hotel_admin(hotel_id)
    and status in ('approved', 'removed_by_hotel')
    and decided_by_user_id = auth.uid()
  );

-- Strictons-side updates (signed_to_placement transition, linked_business_id,
-- candidate metadata corrections) all go via the service-role client and
-- bypass RLS / column GRANTs.

-- DELETE not exposed to authenticated; service role only (rare correction).
