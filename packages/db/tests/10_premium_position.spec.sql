-- ============================================================================
-- 10: Premium ad_position is unique per guide. Standard positions can repeat.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

select plan(4);

select _test_reset_role();

create temp table _t (k text primary key, v uuid);

insert into _t values ('hotel', _test_seed_hotel('india', 'India Hotel'));
insert into _t values ('guide', _test_seed_guide((select v from _t where k='hotel')));
insert into _t values ('biz_a', _test_seed_business('India A Pty Ltd'));
insert into _t values ('biz_b', _test_seed_business('India B Pty Ltd'));
insert into _t values ('biz_c', _test_seed_business('India C Pty Ltd'));
insert into _t values ('biz_d', _test_seed_business('India D Pty Ltd'));

-- ---- First premium_inside_front succeeds ----------------------------------

select lives_ok(
  format(
    $$insert into public.ad_placements (guide_id, business_id, ad_size, ad_position, price_cents)
      values (%L, %L, 'full', 'premium_inside_front', 350000)$$,
    (select v from _t where k='guide'),
    (select v from _t where k='biz_a')
  ),
  'first premium_inside_front in guide succeeds'
);

-- ---- Second premium_inside_front in same guide fails (EXCLUDE) ------------

select throws_ok(
  format(
    $$insert into public.ad_placements (guide_id, business_id, ad_size, ad_position, price_cents)
      values (%L, %L, 'full', 'premium_inside_front', 350000)$$,
    (select v from _t where k='guide'),
    (select v from _t where k='biz_b')
  ),
  null, null,
  'second premium_inside_front in same guide raises (EXCLUDE constraint)'
);

-- ---- Different premium position in same guide succeeds --------------------

select lives_ok(
  format(
    $$insert into public.ad_placements (guide_id, business_id, ad_size, ad_position, price_cents)
      values (%L, %L, 'full', 'premium_inside_back', 350000)$$,
    (select v from _t where k='guide'),
    (select v from _t where k='biz_b')
  ),
  'different premium ad_position (premium_inside_back) in same guide succeeds'
);

-- ---- Two standard positions in same guide is fine -----------------------

insert into public.ad_placements (guide_id, business_id, ad_size, ad_position, price_cents)
values ((select v from _t where k='guide'), (select v from _t where k='biz_c'), 'half', 'standard', 160000);

select lives_ok(
  format(
    $$insert into public.ad_placements (guide_id, business_id, ad_size, ad_position, price_cents)
      values (%L, %L, 'quarter', 'standard', 90000)$$,
    (select v from _t where k='guide'),
    (select v from _t where k='biz_d')
  ),
  'multiple standard ad_positions in same guide allowed (EXCLUDE only fires for non-standard)'
);

select * from finish();

rollback;
