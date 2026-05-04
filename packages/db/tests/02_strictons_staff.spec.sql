-- ============================================================================
-- 02: Strictons staff role sees and writes per the policy matrix.
-- ----------------------------------------------------------------------------
-- Sanity test of the staff bypass — staff should see every protected table
-- and be able to perform the management actions called out in the brief
-- (insert candidate_businesses, transition quality_concerns, etc.).
-- ============================================================================

\set ON_ERROR_STOP on

begin;

select plan(12);

-- All seeding runs as postgres (caller-owned), BEFORE the role switch.
-- This includes ad_placements and audit_log INSERTs, which authenticated
-- (even staff) cannot perform — INSERT into ad_placements has no policy
-- granting authenticated, and audit_log has its INSERT explicitly revoked
-- from authenticated/anon. Postgres bypasses RLS during seed.
select _test_reset_role();
select _test_seed_user('not-staff@example.test');

create temp table _t_ids (k text, v uuid);
-- Grant temp-table access across all roles so reads survive SET ROLE in
-- this transaction. Smell flagged in suite-09 fix commit; the long-term
-- fix is to restructure these suites to capture ids via set_config /
-- current_setting rather than a session-scoped table.
grant select, insert on _t_ids to public;
insert into _t_ids (k, v)
  select 'staff', _test_seed_strictons_staff('staff@example.test');
insert into _t_ids (k, v)
  select 'hotel', _test_seed_hotel('beta', 'Beta Hotel');
insert into _t_ids (k, v)
  select 'guide', _test_seed_guide((select v from _t_ids where k='hotel'));
insert into _t_ids (k, v)
  select 'business', _test_seed_business('Beta Cafes Pty Ltd');

-- Pre-seed an ad_placement so the staff quality_concern INSERT later has
-- a target.
insert into public.ad_placements (guide_id, business_id, ad_size, price_cents)
values (
  (select v from _t_ids where k='guide'),
  (select v from _t_ids where k='business'),
  'half',
  160000
);

-- Pre-seed an audit_log row so the staff append-only-trigger tests later
-- have a row to attempt UPDATE / DELETE against.
insert into public.audit_log (actor_role, action, entity_type, entity_id)
values ('strictons_staff', 'seed', 'hotels', (select v from _t_ids where k='hotel'));

-- Switch to staff for the assertions.
select _test_as_user((select v from _t_ids where k='staff'));

-- ---- SELECT visibility -----------------------------------------------------

select isnt((select count(*)::int from public.users), 0, 'staff SELECT users sees rows');
select isnt((select count(*)::int from public.hotels), 0, 'staff SELECT hotels sees rows');
select isnt((select count(*)::int from public.guides), 0, 'staff SELECT guides sees rows');
select isnt((select count(*)::int from public.businesses), 0, 'staff SELECT businesses sees rows');

-- Empty tables visible (zero rows but no error).
select lives_ok(
  $$select count(*) from public.events$$,
  'staff SELECT events lives (table is empty but visible)'
);
select lives_ok(
  $$select count(*) from public.audit_log$$,
  'staff SELECT audit_log lives'
);

-- ---- Writes that staff is the only role allowed to do ---------------------

-- Insert a candidate_business row (Strictons curation).
select lives_ok(
  format(
    $$insert into public.candidate_businesses (hotel_id, source, name)
      values (%L, 'manual', 'Beta Hardware')$$,
    (select v from _t_ids where k='hotel')
  ),
  'staff INSERT candidate_businesses succeeds'
);

-- Strictons resolution of a quality_concern (placement was pre-seeded above).
select lives_ok(
  format(
    $$insert into public.quality_concerns (ad_placement_id, status, raised_at)
      select id, 'review_requested', now() from public.ad_placements
      where business_id = %L$$,
    (select v from _t_ids where k='business')
  ),
  'staff INSERT quality_concerns succeeds'
);

select lives_ok(
  $$update public.quality_concerns
      set status = 'dismissed', resolved_at = now(), resolution_notes = 'staff resolved'
      where status = 'review_requested'$$,
  'staff UPDATE quality_concerns -> dismissed succeeds'
);

-- ---- Staff cannot bypass append-only on audit_log -------------------------
-- Even staff bypassing RLS via SELECT policies still hits the append-only
-- triggers on UPDATE/DELETE, because the triggers RAISE regardless of role.
-- (audit_log row was pre-seeded above as postgres; staff cannot INSERT
-- because audit_log INSERT is revoked from authenticated.)

select throws_ok(
  $$update public.audit_log set action = 'tampered' where true$$,
  null, null,
  'staff UPDATE audit_log raises (append-only trigger)'
);

select throws_ok(
  $$delete from public.audit_log where true$$,
  null, null,
  'staff DELETE audit_log raises (append-only trigger)'
);

-- mood_options visibility (staff sees retired and active alike).
select lives_ok(
  $$select count(*) from public.mood_options$$,
  'staff SELECT mood_options lives'
);

select * from finish();

rollback;
