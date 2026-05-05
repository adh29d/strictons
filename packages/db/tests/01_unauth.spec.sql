-- ============================================================================
-- 01: Anonymous (unauthenticated) role denied on every protected table.
-- ----------------------------------------------------------------------------
-- For SELECT, RLS without an anon-applicable policy returns 0 rows. For
-- INSERT/UPDATE/DELETE, RLS raises insufficient_privilege / row-level
-- security policy violation. We assert both behaviours.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

select plan(21);

-- Seed minimal data as postgres so anon has something to (fail to) see.
select _test_reset_role();
select _test_seed_user('seed-a@example.test');
select _test_seed_strictons_staff('seed-b@example.test');
select _test_seed_hotel('alpha', 'Alpha Hotel');
select _test_seed_business('Alpha Boats Pty Ltd');

-- Now switch to anon for the assertions.
select _test_as_anon();

-- ---- SELECT: zero rows under anon -----------------------------------------

select is((select count(*)::int from public.users), 0, 'anon SELECT users -> 0');
select is((select count(*)::int from public.strictons_staff), 0, 'anon SELECT strictons_staff -> 0');
select is((select count(*)::int from public.hotels), 0, 'anon SELECT hotels -> 0');
select is((select count(*)::int from public.hotel_users), 0, 'anon SELECT hotel_users -> 0');
select is((select count(*)::int from public.guides), 0, 'anon SELECT guides -> 0');
select is((select count(*)::int from public.businesses), 0, 'anon SELECT businesses -> 0');
select is((select count(*)::int from public.business_users), 0, 'anon SELECT business_users -> 0');
select is((select count(*)::int from public.ad_placements), 0, 'anon SELECT ad_placements -> 0');
select is((select count(*)::int from public.briefs), 0, 'anon SELECT briefs -> 0');
select is((select count(*)::int from public.candidate_businesses), 0, 'anon SELECT candidate_businesses -> 0');
select is((select count(*)::int from public.qr_codes), 0, 'anon SELECT qr_codes -> 0');
select is((select count(*)::int from public.events), 0, 'anon SELECT events -> 0');
select is((select count(*)::int from public.audit_log), 0, 'anon SELECT audit_log -> 0');

-- mood_options is also locked — anon has no SELECT policy on the underlying
-- table; the active_mood_options view inherits via security_invoker so anon
-- through the view also sees nothing.
select is((select count(*)::int from public.mood_options), 0, 'anon SELECT mood_options -> 0');
select is((select count(*)::int from public.active_mood_options), 0, 'anon SELECT active_mood_options -> 0');

-- ---- INSERT/UPDATE/DELETE: denied -----------------------------------------

select throws_ok(
  $$insert into public.hotels (slug, name, contact_email)
    values ('anon-attempt', 'Pwned', 'pwn@example.test')$$,
  null, null,
  'anon INSERT hotels denied'
);

select throws_ok(
  $$insert into public.events (event_type, session_id, serving_domain)
    values ('page_view', gen_random_uuid(), 'mystay.au')$$,
  null, null,
  'anon INSERT events denied'
);

select throws_ok(
  $$insert into public.audit_log (actor_role, action, entity_type, entity_id)
    values ('anonymous', 'pwn', 'hotels', gen_random_uuid())$$,
  null, null,
  'anon INSERT audit_log denied'
);

select throws_ok(
  $$update public.hotels set name = 'Pwned' where true$$,
  null, null,
  'anon UPDATE hotels denied (raises at GRANT layer, not silently 0-rows under RLS)'
);

select throws_ok(
  $$delete from public.hotels where true$$,
  null, null,
  'anon DELETE hotels denied (raises at GRANT layer)'
);

-- Structural audit: every INSERT / UPDATE / DELETE GRANT on a public table
-- to anon or authenticated must be backed by an RLS policy that permits
-- that role + that operation. Catches both:
--   * orphan GRANTs to anon (should be zero — anon has no legitimate
--     write path on any public table per the locked decision)
--   * orphan GRANTs to authenticated (a GRANT that no policy permits is
--     a silent-zero-rows bug, the same shape as the original Issue A
--     finding on hotels)
--
-- Extension-owned objects (e.g. pgTAP's pg_all_foreign_keys and tap_funky
-- helper relations, installed in public by `create extension pgtap`) are
-- excluded via pg_depend. The audit's job is to enforce *our* schema's
-- security surface; an extension's internal helpers are out of scope and
-- have no application-level RLS policies anyway.
--
-- The assertion scales — no per-table enumeration, catches new tables
-- automatically as they're added in later phases. Future extensions
-- installed in public are auto-excluded.
select is(
  (
    select count(*)::int
    from information_schema.role_table_grants rtg
    where rtg.grantee in ('anon', 'authenticated')
      and rtg.table_schema = 'public'
      and rtg.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      and not exists (
        select 1
        from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = rtg.table_name
          and rtg.grantee = any (p.roles)
          and (p.cmd = rtg.privilege_type or p.cmd = 'ALL')
      )
      and not exists (
        select 1
        from pg_depend d
        join pg_class c on c.oid = d.objid
        join pg_namespace n on n.oid = c.relnamespace
        where d.classid = 'pg_class'::regclass
          and d.refclassid = 'pg_extension'::regclass
          and d.deptype = 'e'
          and n.nspname = rtg.table_schema
          and c.relname = rtg.table_name
      )
  ),
  0,
  'no public table grants INSERT/UPDATE/DELETE to anon or authenticated without a backing RLS policy (structural audit)'
);

select * from finish();

rollback;
