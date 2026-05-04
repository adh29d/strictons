-- ============================================================================
-- 08: service_role bypasses RLS on every table — the mystay rendering path.
-- ----------------------------------------------------------------------------
-- This is the positive path that makes the locked decision viable: anon
-- has no RLS coverage anywhere, mystay reads via service-role server-side.
-- The test confirms service_role can SELECT every protected table without
-- any RLS-related restriction.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

select plan(14);

select _test_reset_role();

create temp table _t (k text primary key, v uuid);
-- Grant temp-table access across all roles so reads survive SET ROLE.
-- See suite-09 fix commit for the smell + planned follow-up.
grant select, insert on _t to public;

insert into _t values ('hotel', _test_seed_hotel('golf', 'Golf Hotel'));
insert into _t values ('guide', _test_seed_guide((select v from _t where k='hotel')));
insert into _t values ('biz', _test_seed_business('Golf Carts Pty Ltd'));

insert into public.ad_placements (guide_id, business_id, ad_size, price_cents)
values ((select v from _t where k='guide'), (select v from _t where k='biz'), 'full', 300000);

insert into public.qr_codes (guide_id, placement_kind, target_url, sequence_in_manifest)
values ((select v from _t where k='guide'), 'welcome', 'https://mystay.au/golf', 1);

insert into public.events (event_type, session_id, hotel_id, guide_id, serving_domain)
values ('page_view', gen_random_uuid(), (select v from _t where k='hotel'), (select v from _t where k='guide'), 'mystay.au');

insert into public.audit_log (actor_role, action, entity_type, entity_id, entity_hotel_id)
values ('strictons_staff', 'create', 'hotels', (select v from _t where k='hotel'), (select v from _t where k='hotel'));

select _test_as_service();

select isnt((select count(*)::int from public.users), 0, 'service_role SELECT users');
select isnt((select count(*)::int from public.hotels), 0, 'service_role SELECT hotels');
select isnt((select count(*)::int from public.hotel_users), -1, 'service_role SELECT hotel_users (table reachable)');
select isnt((select count(*)::int from public.guides), 0, 'service_role SELECT guides');
select isnt((select count(*)::int from public.businesses), 0, 'service_role SELECT businesses');
select isnt((select count(*)::int from public.ad_placements), 0, 'service_role SELECT ad_placements');
select isnt((select count(*)::int from public.qr_codes), 0, 'service_role SELECT qr_codes');
select isnt((select count(*)::int from public.events), 0, 'service_role SELECT events');
select isnt((select count(*)::int from public.audit_log), 0, 'service_role SELECT audit_log');
select isnt((select count(*)::int from public.mood_options), 0, 'service_role SELECT mood_options');
select isnt((select count(*)::int from public.briefs), -1, 'service_role SELECT briefs (reachable)');
select isnt((select count(*)::int from public.brief_assets), -1, 'service_role SELECT brief_assets (reachable)');
select isnt((select count(*)::int from public.candidate_businesses), -1, 'service_role SELECT candidate_businesses (reachable)');
select isnt((select count(*)::int from public.strictons_staff), -1, 'service_role SELECT strictons_staff (reachable)');

select * from finish();

rollback;
