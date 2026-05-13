-- ============================================================================
-- Migration 14 — partner invite tracking columns and revoke policies.
-- ----------------------------------------------------------------------------
-- Phase 3 (magic-link auth for the partners app) introduces an invite/revoke
-- audit trail on hotel_users and business_users:
--
--   invited_by   uuid → public.users(id) on delete set null
--   revoked_at   timestamptz
--   revoked_by   uuid → public.users(id) on delete set null
--
-- Soft-revoke (revoked_at + revoked_by) is the partners-app member-removal
-- mechanism; the four membership-helper functions are refined here to
-- exclude revoked rows so RLS treats a revoked member as a non-member on
-- every other table.
--
-- Hard delete on these tables remains available via the existing
-- `<table>_delete_admin` and `<table>_delete_strictons` policies for
-- unaccepted typo-invites; soft-revoke is the path for any membership
-- whose accept_at has already populated.
--
-- ----------------------------------------------------------------------------
-- Column GRANT changes (the subtle part)
-- ----------------------------------------------------------------------------
-- Phase 2 left both tables with full table-level INSERT/UPDATE GRANTs to
-- authenticated. Migration 14 narrows that surface by replacing the
-- table-level GRANTs with column-restricted ones, on both tables:
--
--   INSERT — only (hotel_id|business_id, invited_email, invited_by). This
--            prevents an admin INSERT from setting user_id, accepted_at,
--            is_admin, revoked_at, or revoked_by — the trigger / service-
--            role reconcile / admin-revoke paths own those columns.
--   UPDATE — only (revoked_at, revoked_by). The Phase 2
--            <table>_update_self_accept policy is dropped here (its sole
--            purpose was to let a user populate accepted_at on first
--            sign-in, which now flows through the service-role server
--            action — see Phase 3 plan §1). Without that drop, an
--            authenticated user could write revoked_at = now() on their
--            own row and self-revoke.
--
-- The new <table>_update_admin_revoke policies enforce the admin-only
-- write path; the column GRANT enforces the column scope independently
-- (defence in depth — admin policy + restricted columns).
--
-- ----------------------------------------------------------------------------
-- Trigger note: set_first_invitee_admin is intentionally left unchanged
-- ----------------------------------------------------------------------------
-- The BEFORE INSERT trigger forces is_admin=true for the first row on each
-- (hotel_id | business_id). It is `language plpgsql` without
-- `security definer`, i.e. it runs as the invoker.
--
-- Excluding is_admin from the new authenticated INSERT GRANT does NOT break
-- the trigger:
--
--   - Postgres column-level INSERT privileges gate the SQL statement's
--     column list, not row materialisation. A BEFORE INSERT trigger's
--     `new.is_admin := true` modifies the in-flight NEW record after the
--     statement-level privilege check, so it is unaffected by the GRANT.
--   - In production, the auto-promote branch (count = 0) only fires for
--     service-role inserts (Strictons creating the very first hotel_user
--     or business_user when the partner signs). Service-role bypasses
--     GRANTs entirely.
--   - Admin-side INSERTs (second invitee onward) reach the trigger with
--     count ≥ 1; the trigger no-ops on is_admin, which the new column
--     GRANT also forbids.
--
-- Defence in depth: even if a malicious admin tried `INSERT ... is_admin
-- = true`, Postgres rejects the statement at parse time because is_admin
-- is not in the column GRANT.
-- ============================================================================

-- ---- Add invite/revoke columns --------------------------------------------

alter table public.hotel_users
  add column invited_by uuid references public.users(id) on delete set null,
  add column revoked_at timestamptz,
  add column revoked_by uuid references public.users(id) on delete set null;

alter table public.business_users
  add column invited_by uuid references public.users(id) on delete set null,
  add column revoked_at timestamptz,
  add column revoked_by uuid references public.users(id) on delete set null;

-- ---- Refine membership-helper functions to exclude revoked rows -----------
-- All four are LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
-- per the Phase 2 baseline. CREATE OR REPLACE preserves dependent policies.

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
      and revoked_at is null
  );
$$;
comment on function public.is_hotel_user(uuid) is
  'True if auth.uid() is an accepted, non-revoked member of the given hotel.';

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
      and revoked_at is null
      and is_admin = true
  );
$$;
comment on function public.is_hotel_admin(uuid) is
  'True if auth.uid() is an accepted, non-revoked admin of the given hotel.';

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
      and revoked_at is null
  );
$$;
comment on function public.is_business_user(uuid) is
  'True if auth.uid() is an accepted, non-revoked member of the given business.';

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
      and revoked_at is null
      and is_admin = true
  );
$$;
comment on function public.is_business_admin(uuid) is
  'True if auth.uid() is an accepted, non-revoked admin of the given business.';

-- ---- Drop the now-superseded self_accept policies -------------------------
-- These were broad "user can update their own row" UPDATE policies. Without
-- a column restriction they would let a user write any column of their own
-- row — including the new revoked_at, which would mean self-revoke. The
-- Phase 3 first-sign-in reconcile flows through a service-role server
-- action, so an authenticated-context "user updates own row" path is not
-- needed at the RLS layer at all.

drop policy "hotel_users_update_self_accept" on public.hotel_users;
drop policy "business_users_update_self_accept" on public.business_users;

-- ---- Tighten INSERT column GRANTs -----------------------------------------
-- Authenticated callers (admin invite path) may only specify
-- (scope_id, invited_email, invited_by). Defaults populate id, is_admin,
-- accepted_at, revoked_at, revoked_by, created_at; the auto-promote
-- trigger may flip is_admin on the first row per (hotel|business) without
-- requiring a column GRANT (see header note).

revoke insert on public.hotel_users from authenticated;
grant insert (hotel_id, invited_email, invited_by)
  on public.hotel_users to authenticated;

revoke insert on public.business_users from authenticated;
grant insert (business_id, invited_email, invited_by)
  on public.business_users to authenticated;

-- ---- Tighten UPDATE column GRANTs -----------------------------------------
-- Authenticated callers may only write (revoked_at, revoked_by) — the
-- soft-revoke surface. All other column mutations (accepted_at, user_id,
-- is_admin) flow through the service-role client per the Phase 2 locked
-- decision "Strictons writes route through the service-role client" and
-- the Phase 3 first-sign-in reconcile.

revoke update on public.hotel_users from authenticated;
grant update (revoked_at, revoked_by)
  on public.hotel_users to authenticated;

revoke update on public.business_users from authenticated;
grant update (revoked_at, revoked_by)
  on public.business_users to authenticated;

-- ---- New admin_revoke RLS policies ----------------------------------------
-- The column GRANT alone is not sufficient — without an UPDATE policy
-- matching the row, RLS would silently filter every admin-revoke attempt
-- to zero rows (the Phase 2 silent-zero-rows lesson). The policy permits
-- admins to UPDATE any row in their hotel/business; the column GRANT
-- restricts which columns those UPDATEs may touch.

create policy "hotel_users_update_admin_revoke"
  on public.hotel_users for update to authenticated
  using (public.is_hotel_admin(hotel_id))
  with check (public.is_hotel_admin(hotel_id));

create policy "business_users_update_admin_revoke"
  on public.business_users for update to authenticated
  using (public.is_business_admin(business_id))
  with check (public.is_business_admin(business_id));

-- The existing <table>_update_strictons policies (Phase 2) remain in place
-- and continue to permit Strictons staff UPDATE via the authenticated
-- role; the new column GRANT now restricts those UPDATEs to
-- (revoked_at, revoked_by) as well. Strictons-side mutations on other
-- columns flow through service-role per the locked decision.
