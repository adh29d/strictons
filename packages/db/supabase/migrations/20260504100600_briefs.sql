-- ============================================================================
-- Cluster F — briefs, brief_assets, mood_options, brief_mood_selections
-- ============================================================================

-- ---- public.mood_options ---------------------------------------------------

create table public.mood_options (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique check (public.is_url_safe_slug(slug)),
  label text not null check (length(trim(label)) > 0),
  description text not null,
  design_treatment_notes text not null,
  reference_image_cloudinary_ids text[] not null default '{}',
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger mood_options_set_updated_at
  before update on public.mood_options
  for each row execute function extensions.moddatetime(updated_at);

comment on column public.mood_options.retired_at is
  'Soft retire. Existing brief_mood_selections referencing a retired option remain valid as historical record.';

-- The active_mood_options view is the canonical query surface for the business
-- portal selector. Filtering retired_at IS NULL at the application layer is
-- explicitly NOT the contract — code should query this view (or use the
-- centralised helper in @strictons/db) so a retired mood cannot leak into
-- the picker by accident.
create view public.active_mood_options
with (security_invoker = true) as
select
  id,
  slug,
  label,
  description,
  design_treatment_notes,
  reference_image_cloudinary_ids,
  created_at
from public.mood_options
where retired_at is null;

grant select on public.active_mood_options to authenticated, anon;

-- ---- public.briefs ---------------------------------------------------------

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  ad_placement_id uuid not null unique references public.ad_placements(id) on delete cascade,
  track public.brief_track not null,
  status public.brief_status not null default 'draft',
  data jsonb not null default '{}'::jsonb,
  signed_off_at timestamptz,
  submitted_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (jsonb_typeof(data) = 'object')
);

create trigger briefs_set_updated_at
  before update on public.briefs
  for each row execute function extensions.moddatetime(updated_at);

create index briefs_placement_idx on public.briefs (ad_placement_id);

-- ---- public.brief_assets ---------------------------------------------------

create table public.brief_assets (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.briefs(id) on delete cascade,
  kind public.brief_asset_kind not null,
  cloudinary_public_id text,
  storage_path text,
  width_px int check (width_px is null or width_px > 0),
  height_px int check (height_px is null or height_px > 0),
  bytes int check (bytes is null or bytes > 0),
  exif jsonb,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- An asset is either Cloudinary-hosted (image) or Supabase-Storage hosted
  -- (PDF / non-image). Exactly one of the two ID fields must be set.
  check (
    (cloudinary_public_id is not null and storage_path is null)
    or (cloudinary_public_id is null and storage_path is not null)
  )
);

create index brief_assets_brief_idx on public.brief_assets (brief_id);

-- ---- public.brief_mood_selections ------------------------------------------

create table public.brief_mood_selections (
  brief_id uuid not null references public.briefs(id) on delete cascade,
  mood_option_id uuid not null references public.mood_options(id) on delete restrict,
  selection_order int not null check (selection_order between 1 and 2),
  created_at timestamptz not null default now(),

  primary key (brief_id, selection_order),
  unique (brief_id, mood_option_id)
);

create index brief_mood_selections_mood_idx on public.brief_mood_selections (mood_option_id);

-- ============================================================================
-- RLS
-- ============================================================================

-- ---- mood_options ----------------------------------------------------------

alter table public.mood_options enable row level security;

-- Authenticated users can SELECT all rows (including retired) — the
-- active_mood_options view filters at the query level. This keeps the
-- table queryable by Strictons admin and by historical brief renders that
-- need to resolve a mood_id even after retirement.
create policy "mood_options_select_authenticated"
  on public.mood_options for select to authenticated
  using (true);

-- INSERT/UPDATE/DELETE service-role only (Strictons content management).

-- ---- briefs ----------------------------------------------------------------

alter table public.briefs enable row level security;

create policy "briefs_select_business"
  on public.briefs for select to authenticated
  using (
    exists (
      select 1 from public.ad_placements ap
      where ap.id = briefs.ad_placement_id
        and public.is_business_user(ap.business_id)
    )
  );

create policy "briefs_select_strictons"
  on public.briefs for select to authenticated
  using (public.is_strictons_staff());

-- Business admin may insert (start a brief) for their own placement.
create policy "briefs_insert_business_admin"
  on public.briefs for insert to authenticated
  with check (
    status = 'draft'
    and exists (
      select 1 from public.ad_placements ap
      where ap.id = briefs.ad_placement_id
        and public.is_business_admin(ap.business_id)
    )
  );

-- Business admin may UPDATE the brief while it's still editable.
-- Once status = 'locked' or 'in_design', business cannot mutate.
create policy "briefs_update_business_admin_editable"
  on public.briefs for update to authenticated
  using (
    status in ('draft', 'submitted')
    and exists (
      select 1 from public.ad_placements ap
      where ap.id = briefs.ad_placement_id
        and public.is_business_admin(ap.business_id)
    )
  )
  with check (
    -- Business may transition draft -> submitted but cannot self-lock or
    -- self-progress to in_design.
    status in ('draft', 'submitted')
    and exists (
      select 1 from public.ad_placements ap
      where ap.id = briefs.ad_placement_id
        and public.is_business_admin(ap.business_id)
    )
  );

create policy "briefs_update_strictons"
  on public.briefs for update to authenticated
  using (public.is_strictons_staff())
  with check (public.is_strictons_staff());

-- ---- brief_assets ----------------------------------------------------------

alter table public.brief_assets enable row level security;

create policy "brief_assets_select_business"
  on public.brief_assets for select to authenticated
  using (
    exists (
      select 1
      from public.briefs b
      join public.ad_placements ap on ap.id = b.ad_placement_id
      where b.id = brief_assets.brief_id
        and public.is_business_user(ap.business_id)
    )
  );

create policy "brief_assets_select_strictons"
  on public.brief_assets for select to authenticated
  using (public.is_strictons_staff());

-- Business admin may upload assets to their own brief while editable.
create policy "brief_assets_insert_business_admin"
  on public.brief_assets for insert to authenticated
  with check (
    exists (
      select 1
      from public.briefs b
      join public.ad_placements ap on ap.id = b.ad_placement_id
      where b.id = brief_assets.brief_id
        and b.status in ('draft', 'submitted')
        and public.is_business_admin(ap.business_id)
    )
  );

create policy "brief_assets_delete_business_admin"
  on public.brief_assets for delete to authenticated
  using (
    exists (
      select 1
      from public.briefs b
      join public.ad_placements ap on ap.id = b.ad_placement_id
      where b.id = brief_assets.brief_id
        and b.status in ('draft', 'submitted')
        and public.is_business_admin(ap.business_id)
    )
  );

create policy "brief_assets_write_strictons"
  on public.brief_assets for all to authenticated
  using (public.is_strictons_staff())
  with check (public.is_strictons_staff());

-- ---- brief_mood_selections -------------------------------------------------

alter table public.brief_mood_selections enable row level security;

create policy "brief_mood_selections_select_business"
  on public.brief_mood_selections for select to authenticated
  using (
    exists (
      select 1
      from public.briefs b
      join public.ad_placements ap on ap.id = b.ad_placement_id
      where b.id = brief_mood_selections.brief_id
        and public.is_business_user(ap.business_id)
    )
  );

create policy "brief_mood_selections_select_strictons"
  on public.brief_mood_selections for select to authenticated
  using (public.is_strictons_staff());

create policy "brief_mood_selections_write_business_admin"
  on public.brief_mood_selections for all to authenticated
  using (
    exists (
      select 1
      from public.briefs b
      join public.ad_placements ap on ap.id = b.ad_placement_id
      where b.id = brief_mood_selections.brief_id
        and b.status in ('draft', 'submitted')
        and public.is_business_admin(ap.business_id)
    )
  )
  with check (
    exists (
      select 1
      from public.briefs b
      join public.ad_placements ap on ap.id = b.ad_placement_id
      where b.id = brief_mood_selections.brief_id
        and b.status in ('draft', 'submitted')
        and public.is_business_admin(ap.business_id)
    )
  );

create policy "brief_mood_selections_write_strictons"
  on public.brief_mood_selections for all to authenticated
  using (public.is_strictons_staff())
  with check (public.is_strictons_staff());
