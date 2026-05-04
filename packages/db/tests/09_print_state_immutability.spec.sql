-- ============================================================================
-- 09: ad_placements.print_state cannot regress from 'printed'.
-- ----------------------------------------------------------------------------
-- The mid-contract removal lock: once an ad has gone to print, the print
-- state is fixed for the term. Digital removal still works, but print is
-- immutable. The trigger fires for every role.
--
-- This suite deliberately does NOT use a temp table for fixture state —
-- temp tables created as postgres are inaccessible after SET ROLE because
-- their default ACL only grants the creator. The seed below uses a DO
-- block with PL/pgSQL variables, and assertions identify the single
-- ad_placement by ad_size since only one row exists in this transaction.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

select plan(4);

select _test_reset_role();

do $$
declare
  v_hotel uuid := _test_seed_hotel('hotel-h', 'Hotel H');
  v_guide uuid := _test_seed_guide(v_hotel);
  v_biz uuid := _test_seed_business('Hotel H Cafe Pty Ltd');
begin
  insert into public.ad_placements (guide_id, business_id, ad_size, price_cents, print_state)
  values (v_guide, v_biz, 'half', 160000, 'not_yet_printed');
end;
$$;

-- ---- Allowed transition: not_yet_printed -> printed -----------------------

select lives_ok(
  $$update public.ad_placements set print_state = 'printed' where ad_size = 'half'$$,
  'transition not_yet_printed -> printed succeeds'
);

-- ---- Disallowed transition: printed -> not_yet_printed --------------------

select throws_ok(
  $$update public.ad_placements set print_state = 'not_yet_printed' where ad_size = 'half'$$,
  null,
  null,
  'transition printed -> not_yet_printed raises (trigger)'
);

-- ---- service_role also blocked --------------------------------------------

select _test_as_service();

select throws_ok(
  $$update public.ad_placements set print_state = 'not_yet_printed' where ad_size = 'half'$$,
  null,
  null,
  'service_role transition printed -> not_yet_printed raises (trigger fires for all roles)'
);

-- ---- Same-state UPDATE is fine (trigger only fires when state actually changes)

select lives_ok(
  $$update public.ad_placements set print_state = 'printed' where ad_size = 'half'$$,
  'idempotent UPDATE printed -> printed succeeds'
);

select * from finish();

rollback;
