-- ============================================================================
-- 04: Business users only see and act on their own business's data.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

select plan(11);

select _test_reset_role();

create temp table _t (k text primary key, v uuid);
-- Grant temp-table access across all roles so reads survive SET ROLE.
-- See suite-09 fix commit for the smell + planned follow-up.
grant select, insert on _t to public;

insert into _t values ('hotel', _test_seed_hotel('charlie', 'Charlie Hotel'));
insert into _t values ('guide', _test_seed_guide((select v from _t where k='hotel')));

insert into _t values ('biz_x', _test_seed_business('X Yacht Charters Pty Ltd'));
insert into _t values ('biz_y', _test_seed_business('Y Bookshop Pty Ltd'));

insert into _t values
  ('admin_x', _test_seed_business_admin((select v from _t where k='biz_x'), 'admin-x@example.test'));
insert into _t values
  ('admin_y', _test_seed_business_admin((select v from _t where k='biz_y'), 'admin-y@example.test'));

-- One placement per business.
insert into public.ad_placements (id, guide_id, business_id, ad_size, price_cents)
  values (gen_random_uuid(), (select v from _t where k='guide'), (select v from _t where k='biz_x'), 'full', 300000);
insert into public.ad_placements (id, guide_id, business_id, ad_size, price_cents)
  values (gen_random_uuid(), (select v from _t where k='guide'), (select v from _t where k='biz_y'), 'quarter', 90000);

-- Each placement gets a brief.
insert into public.briefs (ad_placement_id, track)
  select id, 'full' from public.ad_placements where business_id = (select v from _t where k='biz_x');
insert into public.briefs (ad_placement_id, track)
  select id, 'quarter' from public.ad_placements where business_id = (select v from _t where k='biz_y');

-- One ad_revision per placement.
insert into public.ad_revisions (ad_placement_id, round_number, submitted_at)
  select id, 1, now() from public.ad_placements where business_id = (select v from _t where k='biz_x');
insert into public.ad_revisions (ad_placement_id, round_number, submitted_at)
  select id, 1, now() from public.ad_placements where business_id = (select v from _t where k='biz_y');

-- Capture brief Y's id so admin_x can try to mutate it by direct reference.
insert into _t
select 'brief_y',
       b.id
  from public.briefs b
  join public.ad_placements ap on ap.id = b.ad_placement_id
 where ap.business_id = (select v from _t where k='biz_y')
 limit 1;

select _test_as_user((select v from _t where k='admin_x'));

-- ---- Visibility: business X user sees X only ------------------------------

select is(
  (select count(*)::int from public.businesses where id = (select v from _t where k='biz_x')),
  1,
  'admin_x sees own business'
);

select is(
  (select count(*)::int from public.businesses where id = (select v from _t where k='biz_y')),
  0,
  'admin_x cannot SELECT business Y'
);

select is(
  (select count(*)::int from public.business_users),
  1,
  'admin_x sees own business_users only'
);

select is(
  (select count(*)::int from public.ad_placements),
  1,
  'admin_x sees only their own ad_placement'
);

select is(
  (select count(*)::int from public.ad_revisions),
  1,
  'admin_x sees only revisions on their own placement'
);

select is(
  (select count(*)::int from public.briefs),
  1,
  'admin_x sees only their own brief'
);

-- ---- Writes: business admin INSERTs business_users for own only -----------

select lives_ok(
  format(
    $$insert into public.business_users (business_id, invited_email)
      values (%L, 'colleague-x@example.test')$$,
    (select v from _t where k='biz_x')
  ),
  'admin_x INSERT business_users for own business succeeds'
);

select throws_ok(
  format(
    $$insert into public.business_users (business_id, invited_email)
      values (%L, 'pwn@example.test')$$,
    (select v from _t where k='biz_y')
  ),
  null, null,
  'admin_x INSERT business_users for business Y denied'
);

-- ---- Brief mutations only on own briefs while editable --------------------

select lives_ok(
  $$update public.businesses set display_name = 'X Yachts' where true$$,
  'admin_x UPDATE own business listing fields succeeds (filtered to own)'
);

-- INSERT a brief asset (cloudinary path) on own brief.
select lives_ok(
  format(
    $$insert into public.brief_assets (brief_id, kind, cloudinary_public_id)
      select id, 'hero_photo', 'cl/seed/x' from public.briefs
       where ad_placement_id in (
         select id from public.ad_placements where business_id = %L
       )$$,
    (select v from _t where k='biz_x')
  ),
  'admin_x INSERT brief_asset on own brief succeeds'
);

-- INSERT a brief asset directly against business Y's brief — RLS WITH CHECK
-- denies because admin_x is not business_admin of biz_y.
select throws_ok(
  format(
    $$insert into public.brief_assets (brief_id, kind, cloudinary_public_id)
      values (%L, 'hero_photo', 'cl/seed/pwn')$$,
    (select v from _t where k='brief_y')
  ),
  null, null,
  'admin_x INSERT brief_asset on brief Y by direct id denied'
);

select * from finish();

rollback;
