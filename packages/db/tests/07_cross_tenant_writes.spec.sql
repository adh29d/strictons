-- ============================================================================
-- 07: Cross-tenant write attempts are denied at the RLS WITH CHECK / GRANT
-- layer. Authenticated callers cannot escalate into tables they don't own.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

select plan(7);

select _test_reset_role();

create temp table _t (k text primary key, v uuid);

insert into _t values ('hotel_a', _test_seed_hotel('foxtrot', 'Foxtrot Hotel'));
insert into _t values ('guide_a', _test_seed_guide((select v from _t where k='hotel_a')));
insert into _t values ('admin_a', _test_seed_hotel_admin((select v from _t where k='hotel_a'), 'admin-a-fox@example.test'));

insert into _t values ('biz_x', _test_seed_business('Foxtrot X Pty Ltd'));
insert into _t values ('biz_y', _test_seed_business('Foxtrot Y Pty Ltd'));
insert into _t values ('admin_x', _test_seed_business_admin((select v from _t where k='biz_x'), 'admin-x-fox@example.test'));

-- ---- hotel_admin cannot INSERT into ad_placements (Strictons only) -------

select _test_as_user((select v from _t where k='admin_a'));

select throws_ok(
  format(
    $$insert into public.ad_placements (guide_id, business_id, ad_size, price_cents)
      values (%L, %L, 'half', 160000)$$,
    (select v from _t where k='guide_a'),
    (select v from _t where k='biz_x')
  ),
  null, null,
  'hotel_admin INSERT ad_placements denied (no policy)'
);

-- ---- hotel_admin cannot INSERT into businesses (Strictons only) ----------

select throws_ok(
  $$insert into public.businesses (legal_name, display_name)
    values ('Pwn Inc', 'Pwn Inc')$$,
  null, null,
  'hotel_admin INSERT businesses denied'
);

-- ---- hotel_admin cannot INSERT into candidate_businesses (Strictons only) -

select throws_ok(
  format(
    $$insert into public.candidate_businesses (hotel_id, source, name)
      values (%L, 'manual', 'pwn')$$,
    (select v from _t where k='hotel_a')
  ),
  null, null,
  'hotel_admin INSERT candidate_businesses denied'
);

-- ---- business_admin cannot INSERT into ad_placements --------------------

select _test_as_user((select v from _t where k='admin_x'));

select throws_ok(
  format(
    $$insert into public.ad_placements (guide_id, business_id, ad_size, price_cents)
      values (%L, %L, 'half', 160000)$$,
    (select v from _t where k='guide_a'),
    (select v from _t where k='biz_x')
  ),
  null, null,
  'business_admin INSERT ad_placements denied'
);

-- ---- business_admin cannot UPDATE ad_placements digital_removed_* ------

-- Need to seed a placement first as postgres so admin_x has a target.
select _test_reset_role();
insert into public.ad_placements (id, guide_id, business_id, ad_size, price_cents)
values (gen_random_uuid(), (select v from _t where k='guide_a'), (select v from _t where k='biz_x'), 'half', 160000);

select _test_as_user((select v from _t where k='admin_x'));

-- UPDATE is REVOKEd from authenticated for ad_placements; expect throws.
select throws_ok(
  $$update public.ad_placements set digital_removed_at = now() where true$$,
  null, null,
  'business_admin UPDATE ad_placements denied (no GRANT)'
);

-- ---- business_admin cannot INSERT business_users for another business --

select throws_ok(
  format(
    $$insert into public.business_users (business_id, invited_email)
      values (%L, 'pwn@example.test')$$,
    (select v from _t where k='biz_y')
  ),
  null, null,
  'business_admin INSERT business_users for other business denied'
);

-- ---- service_role can do everything (for completeness) -----------------

select _test_as_service();

select lives_ok(
  format(
    $$insert into public.candidate_businesses (hotel_id, source, name)
      values (%L, 'manual', 'service-role-add')$$,
    (select v from _t where k='hotel_a')
  ),
  'service_role INSERT candidate_businesses succeeds'
);

select * from finish();

rollback;
