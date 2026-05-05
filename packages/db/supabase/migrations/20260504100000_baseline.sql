-- ============================================================================
-- Strictons baseline migration
-- ----------------------------------------------------------------------------
-- Establishes extensions, enums, helper functions, and conventions used by
-- every subsequent migration. Tables and policies live in their own
-- per-cluster migrations following this one.
--
-- Conventions referenced by later migrations:
--   * id          uuid pk default gen_random_uuid()
--   * created_at  timestamptz not null default now()
--   * updated_at  timestamptz not null default now() with moddatetime trigger
--   * money       bigint, suffixed _cents, comment "AUD inclusive of GST"
-- ============================================================================

-- ---- Extensions ------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists moddatetime with schema extensions;

-- ---- Enums -----------------------------------------------------------------

create type public.actor_role as enum (
  'strictons_staff',
  'hotel_admin',
  'hotel_user',
  'business_admin',
  'business_user',
  'system',
  'anonymous'
);

-- Hotel approval state machine.
--
-- Legal transitions (Strictons-driven unless noted):
--
--   pending_design_meeting
--     -> design_meeting_held
--   design_meeting_held
--     -> candidate_list_drafted
--   candidate_list_drafted
--     -> candidate_list_with_hotel
--          (sets candidate_list_approval_due_at = now() + 14 days)
--   candidate_list_with_hotel
--     -> candidate_list_approved          (hotel_admin action via portal)
--     -> paused_awaiting_hotel_response   (auto, on due-date expiry)
--   paused_awaiting_hotel_response
--     -> candidate_list_with_hotel        (Strictons re-prompts)
--     -> candidate_list_approved          (hotel_admin catches up)
--   candidate_list_approved
--     -> businesses_pitching
--   businesses_pitching
--     -> final_guide_with_hotel
--          (sets final_guide_approval_due_at = now() + 14 days)
--   final_guide_with_hotel
--     -> final_guide_approved             (hotel_admin action via portal)
--     -> paused_awaiting_hotel_response   (auto, on due-date expiry)
--   final_guide_approved
--     -> in_print
--   in_print
--     -> distributing
--
-- Notes:
--   * No auto-approval on deadline expiry. Pause + manual follow-up only
--     (locked decision: 2-week window + Strictons mediation).
--   * `paused_awaiting_hotel_response` is reachable from either the candidate
--     list step or the final guide step; the source is recoverable from
--     audit_log.
--   * Once `distributing`, the hotel record stays in this state for the
--     12-month term. Renewal creates a new `guides` row, not a state reset.
create type public.hotel_approval_state as enum (
  'pending_design_meeting',
  'design_meeting_held',
  'candidate_list_drafted',
  'candidate_list_with_hotel',
  'candidate_list_approved',
  'paused_awaiting_hotel_response',
  'businesses_pitching',
  'final_guide_with_hotel',
  'final_guide_approved',
  'in_print',
  'distributing'
);

create type public.guide_status as enum (
  'design',
  'in_print',
  'distributing',
  'expired'
);

create type public.ad_size as enum (
  'quarter',
  'half',
  'full'
);

create type public.ad_position as enum (
  'standard',
  'premium_inside_front',
  'premium_inside_back',
  'premium_other'
);

create type public.contract_status as enum (
  'invited',
  'signed_pending_deposit',
  'signed',
  'completed',
  'cancelled'
);

create type public.print_state as enum (
  'not_yet_printed',
  'printed'
);

create type public.quality_concern_status as enum (
  'review_requested',
  'dismissed',
  'action_taken'
);

create type public.candidate_source as enum (
  'google_places',
  'csv',
  'manual'
);

create type public.candidate_status as enum (
  'proposed',
  'approved',
  'removed_by_hotel',
  'signed_to_placement'
);

create type public.brief_track as enum (
  'quarter',
  'half_treatment_a',
  'half_treatment_b',
  'half_treatment_c',
  'full',
  'self_supplied'
);

create type public.brief_status as enum (
  'draft',
  'submitted',
  'locked',
  'in_design'
);

create type public.brief_asset_kind as enum (
  'logo_vector',
  'logo_raster',
  'hero_photo',
  'brand_guidelines_pdf',
  'reference_ad'
);

create type public.qr_placement_kind as enum (
  'welcome',
  'map',
  'business_listing',
  'amenity',
  'room_service',
  'events',
  'other'
);

create type public.event_type as enum (
  'page_view',
  'qr_scan',
  'outbound_click',
  'offer_redemption',
  'phone_tap',
  'directions_tap',
  'social_click',
  'booking_link_click'
);

create type public.referrer_type as enum (
  'qr_scan',
  'pre_arrival_email',
  'direct',
  'internal_navigation'
);

create type public.device_type as enum (
  'mobile',
  'tablet',
  'desktop'
);

create type public.outbound_destination as enum (
  'booking',
  'social_instagram',
  'social_facebook',
  'social_tiktok',
  'social_other',
  'website',
  'phone',
  'directions'
);

-- redemption_method: business_portal_entry is the only value emitted at v1.
-- geo_confirmed is reserved for a future geo-confirmed redemption flow and
-- is intentionally enumerated now so adding the value later does not require
-- a column-level enum migration on the (large) events table.
create type public.redemption_method as enum (
  'business_portal_entry',
  'geo_confirmed'
);
comment on type public.redemption_method is
  'business_portal_entry: live at v1. geo_confirmed: reserved future value, not emitted by any code path at v1.';

-- ---- Slug shape check (used by hotels.slug and elsewhere) ------------------

create or replace function public.is_url_safe_slug(value citext)
returns boolean
language sql
immutable
as $$
  select value ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' and length(value) between 2 and 64;
$$;
comment on function public.is_url_safe_slug(citext) is
  'Returns true if value is a lowercase URL-safe slug (a-z, 0-9, hyphen; no leading/trailing hyphen; 2-64 chars).';

-- ---- First-invitee auto-admin trigger function -----------------------------
-- Used by hotel_users and business_users in their respective migrations.
-- The first row inserted for a given hotel_id (or business_id) is forced to
-- is_admin = true regardless of what the caller passed. Subsequent rows
-- respect the caller's value.

create or replace function public.set_first_invitee_admin()
returns trigger
language plpgsql
as $$
declare
  scope_id uuid;
  scope_col text;
  existing_count int;
begin
  scope_col := tg_argv[0];
  execute format('select ($1).%I', scope_col) into scope_id using new;
  execute format(
    'select count(*) from public.%I where %I = $1',
    tg_table_name, scope_col
  ) into existing_count using scope_id;

  if existing_count = 0 then
    new.is_admin := true;
  end if;

  return new;
end;
$$;
comment on function public.set_first_invitee_admin() is
  'BEFORE INSERT trigger function: forces is_admin=true on the first row for a given scope column (hotel_id or business_id). Attach via CREATE TRIGGER ... EXECUTE FUNCTION set_first_invitee_admin(''<scope_col>'').';
