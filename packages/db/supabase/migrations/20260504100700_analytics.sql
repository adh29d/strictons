-- ============================================================================
-- Cluster G — qr_codes, events, events_hourly, events_daily, events_monthly
-- ----------------------------------------------------------------------------
-- The events table and its rollups are the renewal-narrative substrate.
-- All mutation paths run through the service role; pg_cron rollup jobs land
-- in Phase 9. Schema is in place from day one so capture can begin as soon
-- as Phase 6 (mystay.au) and Phase 9 (capture endpoints) are wired.
-- ============================================================================

-- ---- public.qr_codes -------------------------------------------------------

create table public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.guides(id) on delete cascade,
  placement_kind public.qr_placement_kind not null,
  business_id uuid references public.businesses(id) on delete set null,
  target_url text not null,
  sequence_in_manifest int not null check (sequence_in_manifest > 0),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (guide_id, sequence_in_manifest),

  -- business_listing placement requires a business_id.
  check (
    (placement_kind = 'business_listing' and business_id is not null)
    or (placement_kind <> 'business_listing')
  )
);

create index qr_codes_guide_idx on public.qr_codes (guide_id);
create index qr_codes_business_idx on public.qr_codes (business_id) where business_id is not null;

-- ---- public.events ---------------------------------------------------------

create table public.events (
  event_id uuid primary key default gen_random_uuid(),
  event_type public.event_type not null,
  occurred_at timestamptz not null default now(),
  session_id uuid not null,

  hotel_id uuid references public.hotels(id) on delete set null,
  guide_id uuid references public.guides(id) on delete set null,
  business_id uuid references public.businesses(id) on delete set null,

  page_type text,
  category text,
  serving_domain text not null,

  referrer_type public.referrer_type,
  qr_code_id uuid references public.qr_codes(id) on delete set null,
  utm_source text,
  utm_medium text,
  utm_campaign text,

  device_type public.device_type,
  os text,
  browser text,
  country text,
  region text,

  ad_size public.ad_size,
  ad_position public.ad_position,
  outbound_destination public.outbound_destination,

  offer_code text,
  redemption_method public.redemption_method
);

-- Indexes per brief 7.5 + locked additions (guide_id, session_id).
create index events_hotel_business_time_idx on public.events (hotel_id, business_id, occurred_at);
create index events_business_time_idx on public.events (business_id, occurred_at) where business_id is not null;
create index events_qr_time_idx on public.events (qr_code_id, occurred_at) where qr_code_id is not null;
create index events_guide_time_idx on public.events (guide_id, occurred_at) where guide_id is not null;
create index events_session_idx on public.events (session_id);

-- ---- Rollup tables (empty skeletons; pg_cron jobs in Phase 9) -------------
-- Granularity per locked decision: includes guide_id so renewal-aware
-- year-over-year comparisons work across contract boundaries.

create table public.events_hourly (
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  guide_id uuid references public.guides(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  event_type public.event_type not null,
  hour timestamptz not null,
  count bigint not null default 0,
  unique_session_count bigint not null default 0,

  unique nulls not distinct (hotel_id, guide_id, business_id, event_type, hour)
);

create index events_hourly_hotel_idx on public.events_hourly (hotel_id, hour);
create index events_hourly_business_idx on public.events_hourly (business_id, hour) where business_id is not null;

create table public.events_daily (
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  guide_id uuid references public.guides(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  event_type public.event_type not null,
  day date not null,
  count bigint not null default 0,
  unique_session_count bigint not null default 0,
  breakdowns jsonb not null default '{}'::jsonb,

  unique nulls not distinct (hotel_id, guide_id, business_id, event_type, day),
  check (jsonb_typeof(breakdowns) = 'object')
);

create index events_daily_hotel_idx on public.events_daily (hotel_id, day);
create index events_daily_business_idx on public.events_daily (business_id, day) where business_id is not null;

create table public.events_monthly (
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  guide_id uuid references public.guides(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  event_type public.event_type not null,
  year_month date not null,
  count bigint not null default 0,
  unique_session_count bigint not null default 0,
  breakdowns jsonb not null default '{}'::jsonb,
  mom_delta bigint,

  unique nulls not distinct (hotel_id, guide_id, business_id, event_type, year_month),
  check (jsonb_typeof(breakdowns) = 'object'),
  -- year_month is always the first of the month.
  check (extract(day from year_month) = 1)
);

create index events_monthly_hotel_idx on public.events_monthly (hotel_id, year_month);
create index events_monthly_business_idx on public.events_monthly (business_id, year_month) where business_id is not null;

-- ============================================================================
-- RLS
-- ============================================================================

-- ---- qr_codes --------------------------------------------------------------

alter table public.qr_codes enable row level security;

create policy "qr_codes_select_hotel"
  on public.qr_codes for select to authenticated
  using (
    exists (
      select 1 from public.guides g
      where g.id = qr_codes.guide_id
        and public.is_hotel_user(g.hotel_id)
    )
  );

create policy "qr_codes_select_strictons"
  on public.qr_codes for select to authenticated
  using (public.is_strictons_staff());

-- INSERT/UPDATE/DELETE service-role only (Strictons admin generates QR
-- manifests; the redirect endpoint resolves via service role).
revoke update on public.qr_codes from authenticated;

-- ---- events ----------------------------------------------------------------

alter table public.events enable row level security;

-- Strictons sees everything; nobody else queries raw events (brief 7.5).
create policy "events_select_strictons"
  on public.events for select to authenticated
  using (public.is_strictons_staff());

-- INSERT path: service-role only (server-side capture endpoints in Phase 9).
-- UPDATE/DELETE: never (raw events are an immutable log).
revoke update on public.events from authenticated;
revoke insert on public.events from authenticated;
revoke delete on public.events from authenticated;
revoke update on public.events from anon;
revoke insert on public.events from anon;
revoke delete on public.events from anon;

-- ---- events_hourly / events_daily / events_monthly -------------------------
-- Common pattern across all three: business_users see rows for their business,
-- hotel_users see rows for their hotel (including hotel-level rows where
-- business_id is null), Strictons sees everything. Inserts are service-role
-- only (rollup jobs).

alter table public.events_hourly enable row level security;
alter table public.events_daily enable row level security;
alter table public.events_monthly enable row level security;

create policy "events_hourly_select_business"
  on public.events_hourly for select to authenticated
  using (business_id is not null and public.is_business_user(business_id));
create policy "events_hourly_select_hotel"
  on public.events_hourly for select to authenticated
  using (public.is_hotel_user(hotel_id));
create policy "events_hourly_select_strictons"
  on public.events_hourly for select to authenticated
  using (public.is_strictons_staff());

create policy "events_daily_select_business"
  on public.events_daily for select to authenticated
  using (business_id is not null and public.is_business_user(business_id));
create policy "events_daily_select_hotel"
  on public.events_daily for select to authenticated
  using (public.is_hotel_user(hotel_id));
create policy "events_daily_select_strictons"
  on public.events_daily for select to authenticated
  using (public.is_strictons_staff());

create policy "events_monthly_select_business"
  on public.events_monthly for select to authenticated
  using (business_id is not null and public.is_business_user(business_id));
create policy "events_monthly_select_hotel"
  on public.events_monthly for select to authenticated
  using (public.is_hotel_user(hotel_id));
create policy "events_monthly_select_strictons"
  on public.events_monthly for select to authenticated
  using (public.is_strictons_staff());

-- INSERT/UPDATE/DELETE on rollups: service-role only.
revoke update, insert, delete on public.events_hourly from authenticated, anon;
revoke update, insert, delete on public.events_daily from authenticated, anon;
revoke update, insert, delete on public.events_monthly from authenticated, anon;
