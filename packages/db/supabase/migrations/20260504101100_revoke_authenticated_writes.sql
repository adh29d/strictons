-- ============================================================================
-- Security: revoke INSERT/UPDATE/DELETE from authenticated where no RLS
-- policy permits it; drop strictons-via-authenticated FOR ALL policies on
-- tables explicitly intended to be service-role-only for writes.
-- ----------------------------------------------------------------------------
-- The same silent-zero-rows hole that prompted the anon revoke
-- (20260504101000_revoke_anon_writes.sql) applies to authenticated on
-- every table that grants the role write GRANTs without a backing policy.
-- An authenticated request can issue UPDATE / DELETE statements that
-- silently match zero rows and return successfully — leaking signal,
-- consuming cycles, and breaking throws-based test assertions.
--
-- The fix mirrors the anon revoke: blanket revoke per (table, op) where
-- no RLS policy permits authenticated writes. For the tables explicitly
-- listed as "service-role-only mutation" in the access matrix
-- (guides, qr_codes, strictons_staff, mood_options, ad_placements
-- INSERT/DELETE, etc.) the strictons-staff bypass policies are also
-- dropped so the only mutation path is via the service-role client per
-- the locked routing decision.
--
-- Audit table-by-table — see PR description for the full matrix. Tables
-- with all-three policies covered (hotel_users, business_users,
-- brief_assets, brief_mood_selections) are not touched here.
-- ============================================================================

-- ---- Drop strictons-via-authenticated FOR ALL policies --------------------
-- These granted Strictons staff INSERT/UPDATE/DELETE via the authenticated
-- role. Strictons mutations on these tables now go via service-role only.

drop policy if exists "guides_write_strictons" on public.guides;
drop policy if exists "print_change_requests_write_strictons" on public.print_change_requests;
drop policy if exists "candidate_businesses_insert_strictons" on public.candidate_businesses;

-- ---- Per-table residual revokes -------------------------------------------

-- users: own row UPDATE (display_name only via column-level GRANT) + staff
-- UPDATE only. No INSERT path (auth.users trigger creates the row via
-- SECURITY DEFINER). No DELETE path (cascades from auth.users).
revoke insert, delete on public.users from authenticated;

-- strictons_staff: SELECT only via authenticated. Membership management is
-- service-role only — the gate that decides who else is staff cannot be
-- raised from inside the app.
revoke insert, update, delete on public.strictons_staff from authenticated;

-- hotels: hotel_admin UPDATE on contact_email only. Strictons-side mutation
-- (approval_state, due dates, name, custom_domain, etc.) via service-role.
revoke insert, delete on public.hotels from authenticated;

-- guides: SELECT only after dropping write_strictons. Contract-artefact
-- lifecycle is service-role only.
revoke insert, update, delete on public.guides from authenticated;

-- print_change_requests: hotel_admin INSERT during eligible window only.
-- Strictons resolution / metadata edits via service-role.
revoke update, delete on public.print_change_requests from authenticated;

-- businesses: business_admin UPDATE on listing-editable columns only.
-- INSERT / DELETE service-role.
revoke insert, delete on public.businesses from authenticated;

-- ad_placements: SELECT only. UPDATE was already revoked; this finishes
-- the lockdown by revoking INSERT and DELETE. Contract artefact lifecycle
-- (signing, deposit, premium-position lock-in, digital removal, print
-- state) is service-role only.
revoke insert, delete on public.ad_placements from authenticated;

-- ad_revisions: SELECT only. UPDATE was already revoked; designer-managed
-- via service-role.
revoke insert, delete on public.ad_revisions from authenticated;

-- self_supplied_ads: business_admin INSERT only. Strictons review path via
-- service-role. UPDATE was already revoked.
revoke delete on public.self_supplied_ads from authenticated;

-- quality_concerns: hotel_admin / strictons INSERT, strictons UPDATE only.
-- No deletion path (concerns are persisted as a record).
revoke delete on public.quality_concerns from authenticated;

-- candidate_businesses: hotel_admin UPDATE on (status, decided_at,
-- decided_by_user_id) only. INSERT was the dropped strictons policy —
-- candidate-list curation via service-role only.
revoke insert, delete on public.candidate_businesses from authenticated;

-- briefs: business_admin INSERT (status=draft) and UPDATE while editable;
-- strictons UPDATE for state-machine transitions. No DELETE path.
revoke delete on public.briefs from authenticated;

-- mood_options: SELECT only. Content management via service-role.
revoke insert, update, delete on public.mood_options from authenticated;

-- qr_codes: SELECT only. UPDATE was already revoked. Manifest generation
-- via service-role.
revoke insert, delete on public.qr_codes from authenticated;

-- ---- Future-table default privileges --------------------------------------
-- Any new public table created hereafter inherits no-write defaults for
-- authenticated. Migrations that need authenticated to write a new table
-- must explicitly GRANT (column-level if appropriate) — same discipline
-- as RLS policy authoring.

alter default privileges in schema public revoke insert, update, delete on tables from authenticated;
