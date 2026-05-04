-- ============================================================================
-- 09: ad_placements.print_state cannot regress from 'printed'.
-- ----------------------------------------------------------------------------
-- The mid-contract removal lock: once an ad has gone to print, the print
-- state is fixed for the term. Digital removal still works, but print is
-- immutable. The trigger fires for every role.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

select plan(4);

select _test_reset_role();

create temp table _t (k text primary key, v uuid);

insert into _t values ('hotel', _test_seed_hotel('hotel-h', 'Hotel H'));
insert into _t values ('guide', _test_seed_guide((select v from _t where k='hotel')));
insert into _t values ('biz', _test_seed_business('Hotel H Cafe Pty Ltd'));
insert into _t values ('placement', gen_random_uuid());

insert into public.ad_placements (id, guide_id, business_id, ad_size, price_cents, print_state)
values ((select v from _t where k='placement'), (select v from _t where k='guide'), (select v from _t where k='biz'), 'half', 160000, 'not_yet_printed');

-- ---- Allowed transition: not_yet_printed -> printed -----------------------

select lives_ok(
  format(
    $$update public.ad_placements set print_state = 'printed' where id = %L$$,
    (select v from _t where k='placement')
  ),
  'transition not_yet_printed -> printed succeeds'
);

-- ---- Disallowed transition: printed -> not_yet_printed --------------------

select throws_ok(
  format(
    $$update public.ad_placements set print_state = 'not_yet_printed' where id = %L$$,
    (select v from _t where k='placement')
  ),
  null, null,
  'transition printed -> not_yet_printed raises (trigger)'
);

-- ---- service_role also blocked --------------------------------------------

select _test_as_service();

select throws_ok(
  format(
    $$update public.ad_placements set print_state = 'not_yet_printed' where id = %L$$,
    (select v from _t where k='placement')
  ),
  null, null,
  'service_role transition printed -> not_yet_printed raises (trigger fires for all roles)'
);

-- ---- Same-state UPDATE is fine (trigger only fires when state actually changes)

select lives_ok(
  format(
    $$update public.ad_placements set print_state = 'printed' where id = %L$$,
    (select v from _t where k='placement')
  ),
  'idempotent UPDATE printed -> printed succeeds'
);

select * from finish();

rollback;
