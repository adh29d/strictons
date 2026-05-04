-- ============================================================================
-- Cluster D — ad_placements, ad_revisions, self_supplied_ads, quality_concerns
-- ============================================================================

-- ---- public.ad_placements --------------------------------------------------

create table public.ad_placements (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.guides(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,

  ad_size public.ad_size not null,
  ad_position public.ad_position not null default 'standard',

  price_cents bigint not null check (price_cents >= 0),
  deposit_paid_at timestamptz,
  balance_paid_at timestamptz,
  contract_signed_at timestamptz,
  contract_status public.contract_status not null default 'invited',

  digital_removed_at timestamptz,
  digital_removed_reason text,
  digital_removed_by_user_id uuid references public.users(id) on delete set null,
  pro_rata_refund_cents bigint check (pro_rata_refund_cents is null or pro_rata_refund_cents >= 0),

  print_state public.print_state not null default 'not_yet_printed',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (guide_id, business_id)
);

comment on column public.ad_placements.price_cents is
  'AUD inclusive of GST.';
comment on column public.ad_placements.pro_rata_refund_cents is
  'AUD inclusive of GST. Only set when digital_removed_at is set.';

-- No two non-standard ad_positions in the same guide.
alter table public.ad_placements
  add constraint ad_placements_premium_unique
  exclude (
    guide_id with =,
    ad_position with =
  ) where (ad_position <> 'standard');

create trigger ad_placements_set_updated_at
  before update on public.ad_placements
  for each row execute function extensions.moddatetime(updated_at);

create index ad_placements_business_idx on public.ad_placements (business_id);
create index ad_placements_guide_idx on public.ad_placements (guide_id);

-- print_state cannot regress once 'printed'. Models the locked rule that
-- print state stays immutable on mid-contract removal.
create or replace function public.enforce_print_state_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.print_state = 'printed' and new.print_state <> 'printed' then
    raise exception 'ad_placements.print_state cannot regress from printed';
  end if;
  return new;
end;
$$;

create trigger ad_placements_print_state_immutable
  before update on public.ad_placements
  for each row
  when (new.print_state is distinct from old.print_state)
  execute function public.enforce_print_state_immutable();

-- ---- public.ad_revisions ---------------------------------------------------

create table public.ad_revisions (
  id uuid primary key default gen_random_uuid(),
  ad_placement_id uuid not null references public.ad_placements(id) on delete cascade,
  round_number int not null check (round_number between 1 and 2),
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  designer_notes text,
  created_at timestamptz not null default now(),

  unique (ad_placement_id, round_number)
);

create index ad_revisions_placement_idx on public.ad_revisions (ad_placement_id);

-- ---- public.self_supplied_ads ----------------------------------------------

create table public.self_supplied_ads (
  id uuid primary key default gen_random_uuid(),
  ad_placement_id uuid not null unique references public.ad_placements(id) on delete cascade,
  storage_path text not null,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);

-- ---- public.quality_concerns -----------------------------------------------

create table public.quality_concerns (
  id uuid primary key default gen_random_uuid(),
  ad_placement_id uuid not null references public.ad_placements(id) on delete cascade,
  raised_by_user_id uuid references public.users(id) on delete set null,
  status public.quality_concern_status not null default 'review_requested',
  raised_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_notes text,

  -- A status that is not 'review_requested' must have a resolved_at.
  check (
    (status = 'review_requested' and resolved_at is null)
    or (status in ('dismissed', 'action_taken') and resolved_at is not null)
  )
);

create index quality_concerns_placement_idx on public.quality_concerns (ad_placement_id);

-- ============================================================================
-- RLS
-- ============================================================================

-- ---- ad_placements ---------------------------------------------------------

alter table public.ad_placements enable row level security;

create policy "ad_placements_select_business"
  on public.ad_placements for select to authenticated
  using (public.is_business_user(business_id));

create policy "ad_placements_select_hotel"
  on public.ad_placements for select to authenticated
  using (
    exists (
      select 1 from public.guides g
      where g.id = ad_placements.guide_id
        and public.is_hotel_user(g.hotel_id)
    )
  );

create policy "ad_placements_select_strictons"
  on public.ad_placements for select to authenticated
  using (public.is_strictons_staff());

-- INSERT/UPDATE/DELETE on ad_placements are intentionally service-role only.
-- The contract artefact lifecycle (signing, deposit, ad_size selection,
-- premium-position lock-in, digital removal, print state) all happen via
-- audited Strictons-internal flows backed by the service-role client.
revoke update on public.ad_placements from authenticated;

-- ---- ad_revisions ----------------------------------------------------------

alter table public.ad_revisions enable row level security;

create policy "ad_revisions_select_business"
  on public.ad_revisions for select to authenticated
  using (
    exists (
      select 1 from public.ad_placements ap
      where ap.id = ad_revisions.ad_placement_id
        and public.is_business_user(ap.business_id)
    )
  );

create policy "ad_revisions_select_strictons"
  on public.ad_revisions for select to authenticated
  using (public.is_strictons_staff());

revoke update on public.ad_revisions from authenticated;
-- INSERT/UPDATE/DELETE service-role only — Strictons designer manages.

-- ---- self_supplied_ads -----------------------------------------------------

alter table public.self_supplied_ads enable row level security;

create policy "self_supplied_ads_select_business"
  on public.self_supplied_ads for select to authenticated
  using (
    exists (
      select 1 from public.ad_placements ap
      where ap.id = self_supplied_ads.ad_placement_id
        and public.is_business_user(ap.business_id)
    )
  );

create policy "self_supplied_ads_select_strictons"
  on public.self_supplied_ads for select to authenticated
  using (public.is_strictons_staff());

-- Business admin uploads. Strictons reviews/approves (via service role).
create policy "self_supplied_ads_insert_business_admin"
  on public.self_supplied_ads for insert to authenticated
  with check (
    exists (
      select 1 from public.ad_placements ap
      where ap.id = self_supplied_ads.ad_placement_id
        and public.is_business_admin(ap.business_id)
    )
  );

revoke update on public.self_supplied_ads from authenticated;

-- ---- quality_concerns ------------------------------------------------------

alter table public.quality_concerns enable row level security;

-- All three sides have read visibility per locked decision.
create policy "quality_concerns_select_hotel"
  on public.quality_concerns for select to authenticated
  using (
    exists (
      select 1 from public.ad_placements ap
      join public.guides g on g.id = ap.guide_id
      where ap.id = quality_concerns.ad_placement_id
        and public.is_hotel_user(g.hotel_id)
    )
  );

create policy "quality_concerns_select_business"
  on public.quality_concerns for select to authenticated
  using (
    exists (
      select 1 from public.ad_placements ap
      where ap.id = quality_concerns.ad_placement_id
        and public.is_business_user(ap.business_id)
    )
  );

create policy "quality_concerns_select_strictons"
  on public.quality_concerns for select to authenticated
  using (public.is_strictons_staff());

-- Hotel admin may RAISE a concern only with status='review_requested'.
-- raised_by_user_id must be the caller. Locks them out of pre-resolved entries.
create policy "quality_concerns_insert_hotel_admin"
  on public.quality_concerns for insert to authenticated
  with check (
    status = 'review_requested'
    and raised_by_user_id = auth.uid()
    and exists (
      select 1 from public.ad_placements ap
      join public.guides g on g.id = ap.guide_id
      where ap.id = quality_concerns.ad_placement_id
        and public.is_hotel_admin(g.hotel_id)
    )
  );

create policy "quality_concerns_insert_strictons"
  on public.quality_concerns for insert to authenticated
  with check (public.is_strictons_staff());

-- Only Strictons may transition status to 'dismissed' or 'action_taken'.
-- Hotel_admin / business_admin have no UPDATE policy.
create policy "quality_concerns_update_strictons"
  on public.quality_concerns for update to authenticated
  using (public.is_strictons_staff())
  with check (public.is_strictons_staff());

-- ============================================================================
-- Cross-cluster policy: hotel_users see businesses with placements in their
-- guides (deferred from the previous migration since ad_placements is now
-- available as a join target).
-- ============================================================================

create policy "businesses_select_hotel_via_placements"
  on public.businesses for select to authenticated
  using (
    exists (
      select 1
      from public.ad_placements ap
      join public.guides g on g.id = ap.guide_id
      where ap.business_id = businesses.id
        and public.is_hotel_user(g.hotel_id)
    )
  );
