-- ============================================================================
-- Migration 15 — Phase 6 candidate-list curation schema.
-- ----------------------------------------------------------------------------
-- Locked decisions reflected in this migration:
--
--   1. "Only on signing" candidate-becomes-business model
--      - candidate_businesses carries inline identifying data (phone,
--        website, contact_email) so a row can stand on its own without a
--        backing businesses row. The businesses row is created at the
--        moment of signing (Phase 7+ work).
--
--   2. Hotel-side surface includes manual add + remove + approve
--      - New INSERT policy `candidate_businesses_insert_hotel_admin_manual`
--        gates hotel-admin INSERTs to source='manual' with
--        proposed_by=auth.uid() and a freshly-proposed shape.
--      - Existing `candidate_businesses_update_hotel_admin` policy is
--        dropped and recreated, narrowed to soft-delete only. The
--        previously-allowed `status='approved'` transition is removed
--        because Phase 6 moves list-level approval to
--        hotels.approval_state (see decision 6 + Q6).
--
--   3. Staff-side: manual + CSV + Google Places (no schema change here;
--      handled by application code via service-role per the Phase 2
--      locked decision "Strictons writes route through the service-role
--      client").
--
--   5. Soft-delete uniformly via removed_at + removed_by columns +
--      optional removal_reason. Template for the deferred hotels /
--      businesses soft-delete work later.
--
--   6. List-approval state machine reuses the existing
--      hotels.approval_state enum's candidate_list_drafted /
--      candidate_list_with_hotel / candidate_list_approved values plus
--      paused_awaiting_hotel_response. New hotel-admin UPDATE policy
--      gates the one transition the hotel can perform (with_hotel ->
--      approved); all other transitions stay service-role.
--
-- ----------------------------------------------------------------------------
-- Q3 — staff-side removal status:
--
-- A new enum value `removed_by_strictons` is appended to
-- public.candidate_status. Staff-side soft-deletes set
-- status='removed_by_strictons'; hotel-side soft-deletes keep
-- status='removed_by_hotel'. The removed_at + removed_by columns remain
-- the canonical "is removed" filter; the status value carries the
-- actor-class signal cleanly without overloading the hotel-only value.
--
-- Postgres constraint: ALTER TYPE ... ADD VALUE runs inside a
-- transaction (Postgres 12+) but the new value cannot be used in DDL or
-- DML within that same transaction. This migration does NOT reference
-- 'removed_by_strictons' in any policy WITH CHECK, CHECK constraint, or
-- INSERT/UPDATE. Only application code at runtime uses the value, and
-- only after this migration's transaction has committed.
--
-- ----------------------------------------------------------------------------
-- Q6 — narrowing the hotel-admin UPDATE policy:
--
-- The Phase 2 hotel-admin UPDATE policy allowed status -> ('approved' OR
-- 'removed_by_hotel'). Phase 6 moves list-level approval onto
-- hotels.approval_state, making the per-row 'approved' transition
-- redundant and confusing. The drop+recreate below removes the
-- now-dead 'approved' transition. The enum value 'approved' itself is
-- NOT removed (append-only-on-applied rule for enums); it stays as a
-- vestigial value with the comment below.
--
-- pgTAP audit (recorded in PHASE_6_PLAN.md §1): no existing spec
-- exercises the now-removed status='approved' hotel-admin UPDATE path.
-- New spec 12 carries the negative coverage explicitly.
--
-- ----------------------------------------------------------------------------
-- decided_by_user_id clarification:
--
-- The Phase 2 column pair (decided_by_user_id, decided_at) is NOT
-- written or read by any Phase 6 code path. It is reserved for the
-- Phase 7+ Strictons-side signed_to_placement transition. Soft-delete
-- uses removed_by; list-level approval lives on
-- hotels.candidate_list_approved_at. The COMMENT ON COLUMN at the foot
-- of this migration documents the reservation so a future reader
-- doesn't accidentally re-purpose the column.
-- ============================================================================

-- ---- Append the staff-removal enum value ----------------------------------

alter type public.candidate_status add value if not exists 'removed_by_strictons';

-- ---- Soft-delete columns + inline contact fields + proposed_by ------------

alter table public.candidate_businesses
  add column removed_at timestamptz,
  add column removed_by uuid references public.users(id) on delete set null,
  add column removal_reason text,
  add column phone text,
  add column website text,
  add column contact_email citext,
  add column proposed_by uuid references public.users(id) on delete set null;

-- removed_at and removed_by move together. removal_reason is independent.
alter table public.candidate_businesses
  add constraint candidate_businesses_removed_pair_check
  check (
    (removed_at is null and removed_by is null)
    or (removed_at is not null and removed_by is not null)
  );

-- ---- Indexes ---------------------------------------------------------------

-- Prevent re-adding the same Google place to the same hotel while it's
-- still alive (not removed) and not yet signed. A legitimate re-add after
-- removal is allowed because the removed row's removed_at is not null and
-- the partial index excludes it.
create unique index candidate_businesses_hotel_place_alive_uidx
  on public.candidate_businesses (hotel_id, google_place_id)
  where google_place_id is not null
    and removed_at is null
    and status <> 'signed_to_placement';

-- Hotel-scoped alive-list reads are the dominant access pattern for both
-- admin and partners surfaces.
create index candidate_businesses_hotel_alive_idx
  on public.candidate_businesses (hotel_id)
  where removed_at is null;

-- ---- Hotel-admin INSERT policy (new) --------------------------------------
-- Hotel admins may add manual candidates. source must be 'manual',
-- proposed_by must be the calling user, and the row must be in the
-- "freshly proposed, not removed, not linked" shape.

create policy "candidate_businesses_insert_hotel_admin_manual"
  on public.candidate_businesses for insert to authenticated
  with check (
    public.is_hotel_admin(hotel_id)
    and source = 'manual'
    and proposed_by = auth.uid()
    and removed_at is null
    and status = 'proposed'
    and linked_business_id is null
  );

-- The existing candidate_businesses_insert_strictons policy continues to
-- cover staff-side INSERTs from any source. Both INSERT policies are
-- evaluated as OR (Postgres RLS semantics).

-- ---- Column GRANTs for the authenticated role -----------------------------
-- Hotel admins write the candidate columns via authenticated; the policy
-- above gates the row shape, these grants gate the column surface.

grant insert (
  hotel_id, source, name, address, category, distance_m,
  phone, website, contact_email, proposed_by, status
) on public.candidate_businesses to authenticated;

-- ---- Drop and recreate the hotel-admin UPDATE policy (Q6) -----------------
-- The Phase 2 policy allowed status -> ('approved' OR 'removed_by_hotel').
-- Phase 6 narrows to soft-delete only. The replacement policy permits a
-- hotel admin to UPDATE one of their hotel's rows ONLY if the new state
-- is the soft-deleted shape (status='removed_by_hotel' + removed_at +
-- removed_by = auth.uid()).

drop policy "candidate_businesses_update_hotel_admin" on public.candidate_businesses;

-- Extend the existing UPDATE column GRANT to cover the soft-delete columns.
-- (The Phase 2 grant was `(status, decided_at, decided_by_user_id)`. Phase 6
-- replaces it entirely; decided_* is no longer in the authenticated GRANT
-- because hotel admins do not touch those columns post-Phase-6.)

revoke update on public.candidate_businesses from authenticated;
grant update (status, removed_at, removed_by, removal_reason)
  on public.candidate_businesses to authenticated;

create policy "candidate_businesses_update_hotel_admin"
  on public.candidate_businesses for update to authenticated
  using (public.is_hotel_admin(hotel_id))
  with check (
    public.is_hotel_admin(hotel_id)
    and status = 'removed_by_hotel'
    and removed_at is not null
    and removed_by = auth.uid()
  );

-- ---- Hotels: hotel-admin UPDATE for list approve --------------------------
-- The Phase 2 hotel-admin column GRANT was (contact_email) only. Phase 6
-- adds (approval_state, candidate_list_approved_at) to cover the one
-- transition the hotel performs: candidate_list_with_hotel ->
-- candidate_list_approved. All other approval_state transitions remain
-- service-role per the Phase 2 locked decision.

grant update (approval_state, candidate_list_approved_at)
  on public.hotels to authenticated;

create policy "hotels_update_admin_approve_candidate_list"
  on public.hotels for update to authenticated
  using (
    public.is_hotel_admin(id)
    and approval_state = 'candidate_list_with_hotel'
  )
  with check (
    public.is_hotel_admin(id)
    and approval_state = 'candidate_list_approved'
    and candidate_list_approved_at is not null
  );

-- The existing hotels_update_admin_contact_email policy (Phase 4) remains
-- in place and continues to cover the contact_email path; both policies
-- coexist as OR.

-- ---- Comments --------------------------------------------------------------

comment on column public.candidate_businesses.removed_at is
  'Soft-delete timestamp. Pair with removed_by; both NULL or both NOT NULL '
  '(candidate_businesses_removed_pair_check). The canonical "alive" filter for '
  'reads. Template for the deferred soft-delete work on hotels and businesses.';

comment on column public.candidate_businesses.removed_by is
  'User who soft-deleted the row. Pairs with removed_at. Distinct from '
  'decided_by_user_id (which is reserved for Phase 7+ signed_to_placement '
  'bookkeeping and is not written or read by Phase 6 code paths).';

comment on column public.candidate_businesses.removal_reason is
  'Optional free-text context for the soft-delete (e.g. "hotel reported '
  'permanently closed"). NULL when no reason was supplied.';

comment on column public.candidate_businesses.proposed_by is
  'User who added the row. Strictons staff for source in (google_places, '
  'csv, manual-staff-side); hotel admin for source=manual hotel-side adds. '
  'Set once at INSERT; never updated.';

comment on column public.candidate_businesses.decided_by_user_id is
  'Reserved for Phase 7+ Strictons-side signed_to_placement bookkeeping. '
  'Not written or read by Phase 6 code paths — hotel removal uses '
  'removed_by, list-level approval lives on hotels.candidate_list_approved_at.';

comment on column public.candidate_businesses.decided_at is
  'Pairs with decided_by_user_id; same Phase 7+ reservation note.';

comment on type public.candidate_status is
  'Per-row status. Phase 6 narrows the hotel-admin UPDATE policy so that '
  '"approved" is no longer reachable as a hotel-driven transition (list-level '
  'approval moved to hotels.approval_state); the enum value remains for '
  'append-only compatibility. removed_by_strictons (Phase 6) is set by '
  'staff-side soft-deletes; removed_by_hotel is set by hotel-side soft-deletes.';
