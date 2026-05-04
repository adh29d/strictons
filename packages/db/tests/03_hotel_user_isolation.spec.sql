-- ============================================================================
-- 03: Hotel users only see and act on their own hotel's data.
-- ----------------------------------------------------------------------------
-- Two hotels seeded; the user belonging to hotel A is denied visibility and
-- write access to hotel B across every hotel-scoped table.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

select plan(14);

select _test_reset_role();

-- Seed hotel A and hotel B with admin members and one guide each.
create temp table _t (k text primary key, v uuid);

insert into _t values ('hotel_a', _test_seed_hotel('alpha', 'Alpha Hotel'));
insert into _t values ('hotel_b', _test_seed_hotel('bravo', 'Bravo Hotel'));

insert into _t values
  ('admin_a', _test_seed_hotel_admin((select v from _t where k='hotel_a'), 'admin-a@example.test'));
insert into _t values
  ('admin_b', _test_seed_hotel_admin((select v from _t where k='hotel_b'), 'admin-b@example.test'));

insert into _t values ('guide_a', _test_seed_guide((select v from _t where k='hotel_a')));
insert into _t values ('guide_b', _test_seed_guide((select v from _t where k='hotel_b')));

insert into _t values ('biz_a', _test_seed_business('Alpha Boats Pty Ltd'));
insert into _t values ('biz_b', _test_seed_business('Bravo Cafes Pty Ltd'));

-- Strictons-curated candidate_businesses for each hotel.
insert into public.candidate_businesses (hotel_id, source, name)
  values ((select v from _t where k='hotel_a'), 'manual', 'Alpha Hardware');
insert into public.candidate_businesses (hotel_id, source, name)
  values ((select v from _t where k='hotel_b'), 'manual', 'Bravo Hardware');

-- Ad placements (must be set up as postgres so RLS doesn't matter).
insert into public.ad_placements (guide_id, business_id, ad_size, price_cents)
  values ((select v from _t where k='guide_a'), (select v from _t where k='biz_a'), 'half', 160000);
insert into public.ad_placements (guide_id, business_id, ad_size, price_cents)
  values ((select v from _t where k='guide_b'), (select v from _t where k='biz_b'), 'half', 160000);

-- QR codes for each hotel's guide.
insert into public.qr_codes (guide_id, placement_kind, target_url, sequence_in_manifest)
  values ((select v from _t where k='guide_a'), 'welcome', 'https://mystay.au/alpha', 1);
insert into public.qr_codes (guide_id, placement_kind, target_url, sequence_in_manifest)
  values ((select v from _t where k='guide_b'), 'welcome', 'https://mystay.au/bravo', 1);

-- Switch to admin_a; assert isolation against hotel B.
select _test_as_user((select v from _t where k='admin_a'));

select is(
  (select count(*)::int from public.hotels),
  1,
  'admin_a sees exactly one hotel (alpha)'
);

select is(
  (select slug::text from public.hotels limit 1),
  'alpha',
  'admin_a sees alpha not bravo'
);

select is(
  (select count(*)::int from public.hotel_users),
  1,
  'admin_a sees exactly one hotel_users row (own membership)'
);

select is(
  (select count(*)::int from public.guides),
  1,
  'admin_a sees only their hotel''s guide'
);

select is(
  (select count(*)::int from public.candidate_businesses),
  1,
  'admin_a sees only their candidate list'
);

select is(
  (select count(*)::int from public.ad_placements),
  1,
  'admin_a sees only ad_placements in their guide'
);

select is(
  (select count(*)::int from public.qr_codes),
  1,
  'admin_a sees only QR codes in their guide'
);

select is(
  (select count(*)::int from public.businesses),
  1,
  'admin_a sees only businesses with placements in their guide'
);

-- Direct cross-tenant SELECT by id returns nothing (RLS filtered).
select is(
  (select count(*)::int from public.hotels where id = (select v from _t where k='hotel_b')),
  0,
  'admin_a cannot SELECT hotel B by id'
);

select is(
  (select count(*)::int from public.guides where id = (select v from _t where k='guide_b')),
  0,
  'admin_a cannot SELECT guide B by id'
);

-- Hotel admin INSERT into hotel_users for OWN hotel — succeeds.
select lives_ok(
  format(
    $$insert into public.hotel_users (hotel_id, invited_email)
      values (%L, 'colleague@example.test')$$,
    (select v from _t where k='hotel_a')
  ),
  'admin_a INSERT hotel_users for own hotel succeeds'
);

-- Hotel admin INSERT into hotel_users for OTHER hotel — denied.
select throws_ok(
  format(
    $$insert into public.hotel_users (hotel_id, invited_email)
      values (%L, 'pwn@example.test')$$,
    (select v from _t where k='hotel_b')
  ),
  null, null,
  'admin_a INSERT hotel_users for hotel B denied'
);

-- Hotel admin can update own hotel contact_email.
select lives_ok(
  format(
    $$update public.hotels set contact_email = 'updated@alpha.test' where id = %L$$,
    (select v from _t where k='hotel_a')
  ),
  'admin_a UPDATE own hotel contact_email succeeds'
);

-- Hotel admin attempting UPDATE on hotel B contact_email — denied (filter).
-- The query "succeeds" but affects 0 rows because RLS hides hotel B.
select is(
  (
    with upd as (
      update public.hotels
        set contact_email = 'pwn@bravo.test'
        where id = (select v from _t where k='hotel_b')
        returning 1
    )
    select count(*)::int from upd
  ),
  0,
  'admin_a UPDATE hotel B contact_email affects 0 rows (filtered by RLS)'
);

select * from finish();

rollback;
