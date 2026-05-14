-- ============================================================================
-- 12: Phase 6 candidate-list curation — RLS, GRANT, CHECK, index coverage.
-- ----------------------------------------------------------------------------
-- Covers the migration 15 surface for the candidate_businesses table and the
-- hotel-admin candidate-list-approve path on the hotels table.
--
--   - Hotel-admin INSERT policy (manual-only, proposed_by=auth.uid(),
--     freshly-proposed shape)
--   - Hotel-admin UPDATE policy (narrowed to soft-delete only; the Phase 2
--     status='approved' transition is removed by Q6)
--   - Hotel-admin UPDATE policy on hotels (with_hotel -> approved only)
--   - Service-role staff-side soft-delete (status='removed_by_strictons')
--   - candidate_status enum has the new removed_by_strictons value
--   - Partial unique index (hotel_id, google_place_id) WHERE alive AND NOT
--     signed
--   - candidate_businesses_removed_pair_check (removed_at + removed_by
--     paired)
--   - Unauth (anon) cannot SELECT, INSERT, UPDATE
-- ============================================================================

\set ON_ERROR_STOP on

begin;

select plan(25);

select _test_reset_role();

create temp table _t (k text primary key, v uuid);
grant select, insert on _t to public;

-- ---- Fixtures --------------------------------------------------------------

insert into _t values ('hotel_a', _test_seed_hotel('mike', 'Mike Hotel'));
insert into _t values ('hotel_b', _test_seed_hotel('november', 'November Hotel'));
insert into _t values
  ('admin_a', _test_seed_hotel_admin((select v from _t where k='hotel_a'), 'admin-a-mike@example.test'));
insert into _t values
  ('admin_b', _test_seed_hotel_admin((select v from _t where k='hotel_b'), 'admin-b-november@example.test'));

-- Strictons-curated rows: pre-mint UUIDs into _t, then INSERT using them.
-- Matches the no-\gset convention of the rest of the suite (suite 11 etc.).
insert into _t values ('cand_a1', gen_random_uuid());
insert into _t values ('cand_a2', gen_random_uuid());
insert into _t values ('cand_b1', gen_random_uuid());

insert into public.candidate_businesses (id, hotel_id, source, name)
  values (
    (select v from _t where k='cand_a1'),
    (select v from _t where k='hotel_a'),
    'manual',
    'Strictons-seed A1'
  );
insert into public.candidate_businesses (id, hotel_id, source, name)
  values (
    (select v from _t where k='cand_a2'),
    (select v from _t where k='hotel_a'),
    'manual',
    'Strictons-seed A2'
  );
insert into public.candidate_businesses (id, hotel_id, source, name)
  values (
    (select v from _t where k='cand_b1'),
    (select v from _t where k='hotel_b'),
    'manual',
    'Strictons-seed B1'
  );

-- Move hotel_a into candidate_list_with_hotel so admin can perform the
-- approve transition in T11. Hotel_b's approval_state is reset to
-- candidate_list_with_hotel just-in-time before T13 (the trigger needs
-- hotel_b in a state where the FROM side passes so the test exercises
-- the rejected target-value branch).
update public.hotels
  set approval_state = 'candidate_list_with_hotel',
      candidate_list_approval_due_at = now() + interval '14 days'
  where id = (select v from _t where k='hotel_a');

-- ============================================================================
-- T1-T5. Hotel-admin INSERT policy.
-- ============================================================================

select _test_as_user((select v from _t where k='admin_a'));

-- T1. Hotel admin INSERTs a manual candidate into their own hotel succeeds
-- when proposed_by = auth.uid() and the shape matches the policy WITH CHECK.
select lives_ok(
  format(
    $$insert into public.candidate_businesses
        (hotel_id, source, name, proposed_by, status)
      values (%L, 'manual', 'Cafe Mike', %L, 'proposed')$$,
    (select v from _t where k='hotel_a'),
    (select v from _t where k='admin_a')
  ),
  'hotel_admin INSERT source=manual + proposed_by=self + status=proposed succeeds'
);

-- T2. Hotel admin INSERT with source='csv' is denied (policy WITH CHECK
-- requires source='manual'). CSV upload is staff-only per locked decision 2.
select throws_ok(
  format(
    $$insert into public.candidate_businesses
        (hotel_id, source, name, proposed_by, status)
      values (%L, 'csv', 'Cafe Csv', %L, 'proposed')$$,
    (select v from _t where k='hotel_a'),
    (select v from _t where k='admin_a')
  ),
  null, null,
  'hotel_admin INSERT source=csv denied (staff-only)'
);

-- T3. Hotel admin INSERT with source='google_places' is denied. Google
-- Places search is staff-only per locked decision 2.
select throws_ok(
  format(
    $$insert into public.candidate_businesses
        (hotel_id, source, name, google_place_id, proposed_by, status)
      values (%L, 'google_places', 'Cafe GP', 'ChIJabc123', %L, 'proposed')$$,
    (select v from _t where k='hotel_a'),
    (select v from _t where k='admin_a')
  ),
  null, null,
  'hotel_admin INSERT source=google_places denied (staff-only)'
);

-- T4. Hotel admin INSERT into another hotel's list is denied
-- (is_hotel_admin(hotel_id) returns false for the cross-tenant hotel).
select throws_ok(
  format(
    $$insert into public.candidate_businesses
        (hotel_id, source, name, proposed_by, status)
      values (%L, 'manual', 'Cross-tenant pwn', %L, 'proposed')$$,
    (select v from _t where k='hotel_b'),
    (select v from _t where k='admin_a')
  ),
  null, null,
  'hotel_admin INSERT into another hotel denied'
);

-- T5. Hotel admin INSERT with proposed_by=other user is denied
-- (WITH CHECK requires proposed_by = auth.uid()).
select throws_ok(
  format(
    $$insert into public.candidate_businesses
        (hotel_id, source, name, proposed_by, status)
      values (%L, 'manual', 'Forged proposed_by', %L, 'proposed')$$,
    (select v from _t where k='hotel_a'),
    (select v from _t where k='admin_b')
  ),
  null, null,
  'hotel_admin INSERT with proposed_by=other-user denied'
);

-- ============================================================================
-- T6-T10. Hotel-admin UPDATE policy.
-- ============================================================================

-- T6. Hotel admin soft-deletes a row in their hotel: sets status to
-- removed_by_hotel + removed_at=now() + removed_by=auth.uid() succeeds.
select lives_ok(
  format(
    $$update public.candidate_businesses
        set status = 'removed_by_hotel',
            removed_at = now(),
            removed_by = auth.uid(),
            removal_reason = 'duplicate of another listing'
        where id = %L$$,
    (select v from _t where k='cand_a1')
  ),
  'hotel_admin soft-deletes a candidate (status=removed_by_hotel + removed_at + removed_by=self)'
);

-- T7. Hotel admin UPDATE status='approved' is denied (Q6 narrowing). The
-- Phase 2 policy allowed this; Phase 6 removes it because list-level
-- approval lives on hotels.approval_state instead.
--
-- WITH CHECK rejection on an UPDATE silently filters to zero rows under
-- some Postgres versions; on others it raises. Either outcome is correct
-- ("update did not persist") — assert via row-count that no row landed
-- in status='approved'.
do $$
declare
  rc int;
begin
  begin
    update public.candidate_businesses
      set status = 'approved'
      where id = (select v from _t where k='cand_a2');
    get diagnostics rc = row_count;
  exception when others then
    rc := 0;
  end;
  perform set_config('test.t7_approved_count', rc::text, true);
end;
$$;

select is(
  (select count(*)::int from public.candidate_businesses
     where id = (select v from _t where k='cand_a2') and status = 'approved'),
  0,
  'hotel_admin UPDATE status=approved is blocked (Q6 narrowing — list-level approval lives on hotels.approval_state)'
);

-- T8. Hotel admin UPDATE status='signed_to_placement' is denied. Only
-- service-role (Phase 7+ work) sets this value.
do $$
begin
  begin
    update public.candidate_businesses
      set status = 'signed_to_placement'
      where id = (select v from _t where k='cand_a2');
  exception when others then
    null;
  end;
end;
$$;

select is(
  (select count(*)::int from public.candidate_businesses
     where id = (select v from _t where k='cand_a2') and status = 'signed_to_placement'),
  0,
  'hotel_admin UPDATE status=signed_to_placement is blocked (Strictons-only transition)'
);

-- T9. Hotel admin UPDATE status='removed_by_strictons' is denied. The
-- staff-side removal-status value is service-role-only.
do $$
begin
  begin
    update public.candidate_businesses
      set status = 'removed_by_strictons',
          removed_at = now(),
          removed_by = auth.uid()
      where id = (select v from _t where k='cand_a2');
  exception when others then
    null;
  end;
end;
$$;

select is(
  (select count(*)::int from public.candidate_businesses
     where id = (select v from _t where k='cand_a2') and status = 'removed_by_strictons'),
  0,
  'hotel_admin UPDATE status=removed_by_strictons is blocked (staff-only value)'
);

-- T10. Hotel admin UPDATE on another hotel's row matches zero rows under
-- RLS (is_hotel_admin(hotel_b.id) is false for admin_a).
do $$
declare
  rc int;
begin
  update public.candidate_businesses
    set status = 'removed_by_hotel',
        removed_at = now(),
        removed_by = auth.uid()
    where id = (select v from _t where k='cand_b1');
  get diagnostics rc = row_count;
  perform set_config('test.t10_cross_count', rc::text, true);
end;
$$;

select is(
  current_setting('test.t10_cross_count')::int,
  0,
  'hotel_admin UPDATE another hotel''s candidate matches zero rows (RLS denies)'
);

-- ============================================================================
-- T11-T16. Hotel-admin UPDATE on hotels.approval_state and the
-- approval-state transition trigger (defense-in-depth backstop).
-- ============================================================================

-- T11. Hotel admin can transition hotels.approval_state from
-- candidate_list_with_hotel to candidate_list_approved (the one allowed
-- one-way transition per Phase 6). Exercises both the new permissive
-- RLS policy AND the new transition trigger's allow-branch.
select lives_ok(
  format(
    $$update public.hotels
        set approval_state = 'candidate_list_approved',
            candidate_list_approved_at = now()
        where id = %L$$,
    (select v from _t where k='hotel_a')
  ),
  'hotel_admin UPDATE hotels.approval_state with_hotel -> approved succeeds'
);

-- T12. Hotel admin trying to reverse the approval (approved -> drafted)
-- is rejected by the transition trigger. hotel_a is now in 'approved'
-- after T11; the trigger fires (approval_state distinct from old) and
-- raises because the transition is not the allowed one.
select throws_ok(
  format(
    $$update public.hotels
        set approval_state = 'candidate_list_drafted',
            candidate_list_approved_at = null
        where id = %L$$,
    (select v from _t where k='hotel_a')
  ),
  '42501',
  null,
  'transition trigger: hotel_admin cannot reverse approve (approved -> drafted) — raises 42501'
);

-- T13. Hotel admin transitioning from with_hotel to a non-approved target
-- value (e.g. drafted) is rejected by the trigger.
-- Setup: reset hotel_b to with_hotel via postgres.
select _test_reset_role();
update public.hotels
  set approval_state = 'candidate_list_with_hotel',
      candidate_list_approval_due_at = now() + interval '14 days',
      candidate_list_approved_at = null
  where id = (select v from _t where k='hotel_b');

select _test_as_user((select v from _t where k='admin_b'));

select throws_ok(
  format(
    $$update public.hotels
        set approval_state = 'candidate_list_drafted'
        where id = %L$$,
    (select v from _t where k='hotel_b')
  ),
  '42501',
  null,
  'transition trigger: hotel_admin cannot transition to a non-approved target — raises 42501'
);

-- T14. Regression guard: hotel admin updating ONLY contact_email (no
-- approval_state change) still succeeds via the existing Phase 4
-- contact_email policy. The trigger's WHEN clause (new.approval_state is
-- distinct from old.approval_state) means the trigger does not fire for
-- contact_email-only updates.
select lives_ok(
  format(
    $$update public.hotels
        set contact_email = 'updated-by-admin-b@example.test'
        where id = %L$$,
    (select v from _t where k='hotel_b')
  ),
  'contact_email-only UPDATE by hotel_admin succeeds (trigger does not fire)'
);

-- T15. Hotel admin attempting to change contact_email AND approval_state
-- in the same UPDATE is rejected by the trigger. The contact_email
-- policy's loose WITH CHECK would have permitted this without the trigger.
-- This is the exact composite-update failure case the trigger guards.
select throws_ok(
  format(
    $$update public.hotels
        set contact_email = 'sneaky-state-change@example.test',
            approval_state = 'candidate_list_drafted'
        where id = %L$$,
    (select v from _t where k='hotel_b')
  ),
  '42501',
  null,
  'transition trigger: composite UPDATE that touches approval_state is rejected even via the contact_email policy'
);

-- T16. Service-role bypass: postgres / service_role can transition the
-- approval_state through any sequence the application code chooses.
-- Strictons-side transitions (drafted -> with_hotel, businesses_pitching,
-- paused, etc.) are owned by service-role code paths.
select _test_reset_role();
select _test_as_service();

select lives_ok(
  format(
    $$update public.hotels
        set approval_state = 'candidate_list_drafted',
            candidate_list_approved_at = null
        where id = %L$$,
    (select v from _t where k='hotel_a')
  ),
  'service_role bypasses the transition trigger and can move approval_state freely'
);

-- ============================================================================
-- T17-T18. Service-role staff-side soft-delete + enum-presence check.
-- ============================================================================

select _test_reset_role();
select _test_as_service();

-- T17. Service-role can write status='removed_by_strictons' (the staff-side
-- soft-delete value introduced by Q3). Bypasses RLS and column GRANTs.
select lives_ok(
  format(
    $$update public.candidate_businesses
        set status = 'removed_by_strictons',
            removed_at = now(),
            removed_by = null,
            removal_reason = 'staff-side soft-delete'
        where id = %L$$,
    (select v from _t where k='cand_a2')
  ),
  'service_role UPDATE status=removed_by_strictons succeeds (Q3 staff-side path)'
);

-- T18. The new enum value is registered on the candidate_status type.
select is(
  (select count(*)::int from pg_type t
     join pg_enum e on e.enumtypid = t.oid
     where t.typname = 'candidate_status' and e.enumlabel = 'removed_by_strictons'),
  1,
  'candidate_status enum has removed_by_strictons value (Q3 append)'
);

-- ============================================================================
-- T19-T20. Partial unique index on (hotel_id, google_place_id) — alive only.
-- ============================================================================

select _test_reset_role();
select _test_as_service();

-- Seed a Google Places row for the alive-vs-removed re-add tests. Service
-- role bypasses RLS so we don't need a hotel-admin context here.
insert into _t values ('cand_gp_a', gen_random_uuid());
insert into public.candidate_businesses
  (id, hotel_id, source, google_place_id, name)
  values (
    (select v from _t where k='cand_gp_a'),
    (select v from _t where k='hotel_a'),
    'google_places',
    'ChIJgooglePlaceTestA',
    'Place A'
  );

-- T19. Adding the same (hotel_id, google_place_id) while the original is
-- alive (removed_at is null AND status <> 'signed_to_placement') raises a
-- unique-violation from the partial index.
select throws_ok(
  format(
    $$insert into public.candidate_businesses
        (hotel_id, source, google_place_id, name)
      values (%L, 'google_places', 'ChIJgooglePlaceTestA', 'Duplicate Place A')$$,
    (select v from _t where k='hotel_a')
  ),
  '23505',
  null,
  'partial unique index rejects re-add of (hotel_id, google_place_id) while alive (23505)'
);

-- Soft-delete the original.
update public.candidate_businesses
  set status = 'removed_by_strictons',
      removed_at = now(),
      removed_by = null
  where id = (select v from _t where k='cand_gp_a');

-- T20. After soft-delete, the partial index excludes the original row, so
-- re-adding the same (hotel_id, google_place_id) succeeds.
select lives_ok(
  format(
    $$insert into public.candidate_businesses
        (hotel_id, source, google_place_id, name)
      values (%L, 'google_places', 'ChIJgooglePlaceTestA', 'Place A re-added')$$,
    (select v from _t where k='hotel_a')
  ),
  'partial unique index allows re-add of (hotel_id, google_place_id) after removal'
);

-- ============================================================================
-- T21-T22. candidate_businesses_removed_pair_check.
-- ============================================================================

-- T21. Setting removed_at without removed_by raises (CHECK violation).
select throws_ok(
  format(
    $$update public.candidate_businesses
        set removed_at = now(), removed_by = null
        where id = %L$$,
    (select v from _t where k='cand_a1')
  ),
  '23514',
  null,
  'removed_pair_check: removed_at NOT NULL with removed_by NULL is rejected'
);

-- T22. Setting removed_by without removed_at raises (CHECK violation).
-- First reset cand_a1 to a clean state.
update public.candidate_businesses
  set status = 'proposed',
      removed_at = null,
      removed_by = null,
      removal_reason = null
  where id = (select v from _t where k='cand_a1');

select throws_ok(
  format(
    $$update public.candidate_businesses
        set removed_at = null, removed_by = %L
        where id = %L$$,
    (select v from _t where k='admin_a'),
    (select v from _t where k='cand_a1')
  ),
  '23514',
  null,
  'removed_pair_check: removed_by NOT NULL with removed_at NULL is rejected'
);

-- ============================================================================
-- T23-T25. Unauth (anon) coverage.
-- ============================================================================

select _test_reset_role();
select _test_as_anon();

-- T23. Anon SELECT returns zero rows (RLS denies; no anon policy on
-- candidate_businesses).
select is(
  (select count(*)::int from public.candidate_businesses),
  0,
  'anon SELECT candidate_businesses returns zero rows'
);

-- T24. Anon INSERT is denied. The blanket revoke from anon (migration 11)
-- means the statement raises permission-denied before RLS evaluates.
select throws_ok(
  format(
    $$insert into public.candidate_businesses
        (hotel_id, source, name)
      values (%L, 'manual', 'anon pwn')$$,
    (select v from _t where k='hotel_a')
  ),
  null, null,
  'anon INSERT candidate_businesses denied'
);

-- T25. Anon UPDATE is denied (same blanket revoke).
select throws_ok(
  format(
    $$update public.candidate_businesses
        set name = 'anon hijack'
        where id = %L$$,
    (select v from _t where k='cand_a1')
  ),
  null, null,
  'anon UPDATE candidate_businesses denied'
);

select * from finish();

rollback;
