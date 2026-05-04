-- ============================================================================
-- 05: audit_log is append-only — UPDATE / DELETE always raise.
-- ----------------------------------------------------------------------------
-- The append-only triggers fire BEFORE UPDATE / DELETE regardless of role,
-- so even service_role (which bypasses RLS) cannot mutate or remove rows.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

select plan(7);

select _test_reset_role();

create temp table _t (k text primary key, v uuid);

insert into _t values ('hotel', _test_seed_hotel('delta', 'Delta Hotel'));
insert into _t values ('staff', _test_seed_strictons_staff('staff-d@example.test'));

-- INSERT a row as postgres (effectively service-role context).
insert into public.audit_log (actor_role, action, entity_type, entity_id, entity_hotel_id)
values (
  'strictons_staff',
  'create',
  'hotels',
  (select v from _t where k='hotel'),
  (select v from _t where k='hotel')
);

-- ---- Service role: UPDATE / DELETE blocked by trigger ---------------------

select _test_as_service();

select throws_ok(
  $$update public.audit_log set action = 'tampered' where true$$,
  null, null,
  'service_role UPDATE audit_log raises (append-only trigger)'
);

select throws_ok(
  $$delete from public.audit_log where true$$,
  null, null,
  'service_role DELETE audit_log raises (append-only trigger)'
);

-- ---- Strictons staff (authenticated): UPDATE / DELETE blocked too ---------

select _test_as_user((select v from _t where k='staff'));

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

-- ---- Authenticated non-staff: INSERT denied (no policy) -------------------

select _test_reset_role();
insert into _t values ('rando', _test_seed_user('rando@example.test'));

select _test_as_user((select v from _t where k='rando'));

select throws_ok(
  $$insert into public.audit_log (actor_role, action, entity_type, entity_id)
    values ('hotel_user', 'pwn', 'hotels', gen_random_uuid())$$,
  null, null,
  'authenticated INSERT audit_log denied (no policy permits)'
);

-- ---- Hotel-scoped read: hotel admin sees their entries -------------------

select _test_reset_role();
insert into _t values ('admin', _test_seed_hotel_admin((select v from _t where k='hotel'), 'admin-d@example.test'));

select _test_as_user((select v from _t where k='admin'));

select is(
  (select count(*)::int from public.audit_log where entity_hotel_id = (select v from _t where k='hotel')),
  1,
  'hotel admin sees audit_log entry scoped to their hotel'
);

select * from finish();

rollback;
