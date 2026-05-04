-- ============================================================================
-- 06: Quality clause — hotel_admin raises only review_requested; only
-- Strictons transitions to dismissed / action_taken.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

select plan(8);

select _test_reset_role();

create temp table _t (k text primary key, v uuid);
-- Grant temp-table access across all roles so reads survive SET ROLE.
-- See suite-09 fix commit for the smell + planned follow-up.
grant select, insert on _t to public;

insert into _t values ('hotel', _test_seed_hotel('echo', 'Echo Hotel'));
insert into _t values ('guide', _test_seed_guide((select v from _t where k='hotel')));
insert into _t values ('biz', _test_seed_business('Echo Eats Pty Ltd'));
insert into _t values ('admin', _test_seed_hotel_admin((select v from _t where k='hotel'), 'hotel-admin-e@example.test'));
insert into _t values ('staff', _test_seed_strictons_staff('staff-e@example.test'));

insert into _t values ('placement', gen_random_uuid());
insert into public.ad_placements (id, guide_id, business_id, ad_size, price_cents)
values (
  (select v from _t where k='placement'),
  (select v from _t where k='guide'),
  (select v from _t where k='biz'),
  'half',
  160000
);

-- ---- hotel_admin: legitimate INSERT with review_requested -----------------

select _test_as_user((select v from _t where k='admin'));

select lives_ok(
  format(
    $$insert into public.quality_concerns (ad_placement_id, raised_by_user_id, status)
      values (%L, %L, 'review_requested')$$,
    (select v from _t where k='placement'),
    (select v from _t where k='admin')
  ),
  'hotel_admin INSERT review_requested succeeds'
);

-- ---- hotel_admin: INSERT with status='dismissed' should fail --------------

select throws_ok(
  format(
    $$insert into public.quality_concerns (ad_placement_id, raised_by_user_id, status, resolved_at)
      values (%L, %L, 'dismissed', now())$$,
    (select v from _t where k='placement'),
    (select v from _t where k='admin')
  ),
  null, null,
  'hotel_admin INSERT dismissed denied (status not allowed)'
);

-- ---- hotel_admin: INSERT with raised_by_user_id != self should fail -------

select throws_ok(
  format(
    $$insert into public.quality_concerns (ad_placement_id, raised_by_user_id, status)
      values (%L, %L, 'review_requested')$$,
    (select v from _t where k='placement'),
    (select v from _t where k='staff')
  ),
  null, null,
  'hotel_admin INSERT with raised_by_user_id != auth.uid() denied'
);

-- ---- hotel_admin: cannot UPDATE the concern to dismissed ------------------

select is(
  (
    with upd as (
      update public.quality_concerns
        set status = 'dismissed', resolved_at = now()
        where status = 'review_requested'
        returning 1
    )
    select count(*)::int from upd
  ),
  0,
  'hotel_admin UPDATE quality_concerns affects 0 rows (no policy)'
);

-- ---- Strictons: can transition status to dismissed -----------------------

select _test_as_user((select v from _t where k='staff'));

select is(
  (
    with upd as (
      update public.quality_concerns
        set status = 'dismissed', resolved_at = now(), resolution_notes = 'staff dismissed'
        where status = 'review_requested'
        returning 1
    )
    select count(*)::int from upd
  ),
  1,
  'Strictons UPDATE quality_concerns -> dismissed succeeds'
);

-- ---- Strictons: can transition to action_taken ---------------------------

-- Create another fresh concern to test action_taken transition.
select _test_reset_role();
insert into public.quality_concerns (ad_placement_id, raised_by_user_id, status)
values (
  (select v from _t where k='placement'),
  (select v from _t where k='admin'),
  'review_requested'
);

select _test_as_user((select v from _t where k='staff'));

select is(
  (
    with upd as (
      update public.quality_concerns
        set status = 'action_taken', resolved_at = now(), resolution_notes = 'removed from digital'
        where status = 'review_requested'
        returning 1
    )
    select count(*)::int from upd
  ),
  1,
  'Strictons UPDATE quality_concerns -> action_taken succeeds'
);

-- ---- Both hotel and business sides see the concern (locked decision) ------

-- Add a business admin to the placement's business and verify they see it.
select _test_reset_role();
insert into _t values ('biz_admin', _test_seed_business_admin((select v from _t where k='biz'), 'biz-admin-e@example.test'));

select _test_as_user((select v from _t where k='biz_admin'));
select is(
  (select count(*)::int from public.quality_concerns),
  2,
  'business_admin sees both quality_concerns on their placement'
);

-- And the hotel admin still sees them.
select _test_as_user((select v from _t where k='admin'));
select is(
  (select count(*)::int from public.quality_concerns),
  2,
  'hotel_admin sees both quality_concerns on their guide''s placement'
);

select * from finish();

rollback;
