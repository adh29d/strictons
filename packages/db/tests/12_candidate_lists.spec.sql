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

select plan(22);

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
-- approve transition in T11. Hotel_b stays in pending_design_meeting so
-- T12/T13 can exercise the "from wrong state" rejections.
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
-- T11-T13. Hotel-admin UPDATE on hotels.approval_state (approve transition).
-- ============================================================================

-- T11. Hotel admin can transition hotels.approval_state from
-- candidate_list_with_hotel to candidate_list_approved (the one allowed
-- one-way transition per Phase 6).
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

-- T12. Hotel admin cannot transition hotels.approval_state FROM
-- candidate_list_approved (USING rejects — not in the with_hotel state).
do $$
declare
  rc int;
begin
  update public.hotels
    set approval_state = 'candidate_list_drafted',
        candidate_list_approved_at = null
    where id = (select v from _t where k='hotel_a');
  get diagnostics rc = row_count;
  perform set_config('test.t12_from_count', rc::text, true);
end;
$$;

select is(
  current_setting('test.t12_from_count')::int,
  0,
  'hotel_admin UPDATE hotels.approval_state from non-with_hotel state matches zero rows'
);

-- T13. Hotel admin cannot transition hotels.approval_state TO a value
-- other than candidate_list_approved (WITH CHECK rejects).
-- Reset hotel_b to with_hotel so the USING side passes, then attempt
-- a target other than approved.
select _test_reset_role();
update public.hotels
  set approval_state = 'candidate_list_with_hotel',
      candidate_list_approval_due_at = now() + interval '14 days'
  where id = (select v from _t where k='hotel_b');

select _test_as_user((select v from _t where k='admin_b'));

do $$
begin
  begin
    update public.hotels
      set approval_state = 'candidate_list_drafted'
      where id = (select v from _t where k='hotel_b');
  exception when others then
    null;
  end;
end;
$$;

select is(
  (select approval_state::text from public.hotels
     where id = (select v from _t where k='hotel_b')),
  'candidate_list_with_hotel',
  'hotel_admin UPDATE hotels.approval_state to non-approved value is blocked'
);

-- ============================================================================
-- T14-T15. Service-role staff-side soft-delete + enum-presence check.
-- ============================================================================

select _test_reset_role();
select _test_as_service();

-- T14. Service-role can write status='removed_by_strictons' (the staff-side
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

-- T15. The new enum value is registered on the candidate_status type.
select is(
  (select count(*)::int from pg_type t
     join pg_enum e on e.enumtypid = t.oid
     where t.typname = 'candidate_status' and e.enumlabel = 'removed_by_strictons'),
  1,
  'candidate_status enum has removed_by_strictons value (Q3 append)'
);

-- ============================================================================
-- T16-T17. Partial unique index on (hotel_id, google_place_id) — alive only.
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

-- T16. Adding the same (hotel_id, google_place_id) while the original is
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

-- T17. After soft-delete, the partial index excludes the original row, so
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
-- T18-T19. candidate_businesses_removed_pair_check.
-- ============================================================================

-- T18. Setting removed_at without removed_by raises (CHECK violation).
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

-- T19. Setting removed_by without removed_at raises (CHECK violation).
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
-- T20-T22. Unauth (anon) coverage.
-- ============================================================================

select _test_reset_role();
select _test_as_anon();

-- T20. Anon SELECT returns zero rows (RLS denies; no anon policy on
-- candidate_businesses).
select is(
  (select count(*)::int from public.candidate_businesses),
  0,
  'anon SELECT candidate_businesses returns zero rows'
);

-- T21. Anon INSERT is denied. The blanket revoke from anon (migration 11)
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

-- T22. Anon UPDATE is denied (same blanket revoke).
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
