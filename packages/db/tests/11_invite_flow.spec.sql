-- ============================================================================
-- 11: Invite-flow soft-revoke gates (Migration 14).
-- ----------------------------------------------------------------------------
-- Migration 14 adds (invited_by, revoked_at, revoked_by) to hotel_users and
-- business_users, refines the four membership-helper functions to exclude
-- revoked rows, and tightens the UPDATE surface so authenticated callers can
-- only write (revoked_at, revoked_by) — gated by the new admin_revoke policies.
--
-- Coverage:
--   - the dropped self_accept policy is genuinely gone — authenticated
--     users cannot UPDATE their own accepted_at directly (column GRANT
--     denies; permission denied error)
--   - non-admin members cannot revoke (silent zero rows under RLS)
--   - hotel_admin / business_admin can revoke their own scope's members
--   - revoked rows fail is_hotel_user / is_business_user (membership-helper
--     filter), so RLS treats them as non-members on every other table
--   - service_role bypasses RLS and column GRANTs (can revoke admins)
-- ============================================================================

\set ON_ERROR_STOP on

begin;

select plan(14);

select _test_reset_role();

create temp table _t (k text primary key, v uuid);
-- Grant temp-table access across all roles so reads survive SET ROLE.
-- See suite-09 for the smell + planned follow-up.
grant select, insert on _t to public;

-- ---- Hotel fixtures --------------------------------------------------------

insert into _t values ('hotel_a', _test_seed_hotel('lima', 'Lima Hotel'));
insert into _t values
  ('admin_a', _test_seed_hotel_admin((select v from _t where k='hotel_a'), 'admin-a@example.test'));
insert into _t values ('user_a', _test_seed_user('user-a@example.test'));

-- A regular (non-admin) member of hotel A. The first-invitee trigger only
-- promotes the very first row per hotel, which was admin_a above.
insert into public.hotel_users (hotel_id, user_id, invited_email, accepted_at)
  values (
    (select v from _t where k='hotel_a'),
    (select v from _t where k='user_a'),
    'user-a@example.test',
    now()
  );

-- ---- Business fixtures -----------------------------------------------------

insert into _t values ('biz_x', _test_seed_business('Mike Massage Pty Ltd'));
insert into _t values
  ('admin_x', _test_seed_business_admin((select v from _t where k='biz_x'), 'admin-x@example.test'));
insert into _t values ('user_x', _test_seed_user('user-x@example.test'));

insert into public.business_users (business_id, user_id, invited_email, accepted_at)
  values (
    (select v from _t where k='biz_x'),
    (select v from _t where k='user_x'),
    'user-x@example.test',
    now()
  );

-- ============================================================================
-- HOTEL — seven tests
-- ============================================================================

-- T1. Dropped self_accept regression: an authenticated user cannot UPDATE
-- their own accepted_at directly. The Phase 2 hotel_users_update_self_accept
-- policy is dropped by Migration 14 (first-sign-in reconcile flows through
-- the service-role server action). With accepted_at outside the column
-- GRANT, Postgres raises permission-denied at parse time before RLS even
-- evaluates — a hard throw, not silent zero rows.
select _test_as_user((select v from _t where k='user_a'));

select throws_ok(
  format(
    $$update public.hotel_users
        set accepted_at = '1900-01-01 00:00:00+00'::timestamptz
      where user_id = %L$$,
    (select v from _t where k='user_a')
  ),
  null,
  null,
  'hotel: dropped self_accept means user cannot UPDATE their own accepted_at (column GRANT denies)'
);

-- T2. Non-admin member cannot revoke another member.
-- The admin_revoke policy USING (is_hotel_admin(hotel_id)) returns false for
-- user_a, so the UPDATE silently matches zero rows (RLS filters). The column
-- GRANT permits writes to (revoked_at, revoked_by) — gating happens at the
-- policy level, not the GRANT level.
select _test_as_user((select v from _t where k='user_a'));

do $$
declare rc int;
begin
  update public.hotel_users
    set revoked_at = now(), revoked_by = (select v from _t where k='user_a')
    where user_id = (select v from _t where k='admin_a');
  get diagnostics rc = row_count;
  perform set_config('test.user_a_revoke_count', rc::text, true);
end;
$$;

select is(
  current_setting('test.user_a_revoke_count')::int,
  0,
  'hotel: non-admin member cannot revoke another member (RLS denies; 0 rows affected)'
);

-- T3. Hotel admin revokes a regular member.
select _test_reset_role();
select _test_as_user((select v from _t where k='admin_a'));

select lives_ok(
  format(
    $$update public.hotel_users
        set revoked_at = now(), revoked_by = %L
      where user_id = %L$$,
    (select v from _t where k='admin_a'),
    (select v from _t where k='user_a')
  ),
  'hotel: admin revokes a regular member (column GRANT + admin_revoke policy)'
);

-- T4. Revoked member fails is_hotel_user.
select _test_reset_role();
select _test_as_user((select v from _t where k='user_a'));

select is(
  public.is_hotel_user((select v from _t where k='hotel_a')),
  false,
  'hotel: is_hotel_user returns false for the revoked member'
);

-- T5. Revoked member sees zero hotels under RLS.
select is(
  (select count(*)::int from public.hotels),
  0,
  'hotel: revoked member sees zero hotels (RLS treats them as non-member)'
);

-- T6. Service role can revoke an admin (bypasses RLS and column GRANTs).
select _test_reset_role();
select _test_as_service();

select lives_ok(
  format(
    $$update public.hotel_users
        set revoked_at = now(), revoked_by = null
      where user_id = %L$$,
    (select v from _t where k='admin_a')
  ),
  'hotel: service_role revokes the admin (bypasses RLS and column GRANT)'
);

-- T7. Revoked admin fails is_hotel_admin.
select _test_reset_role();
select _test_as_user((select v from _t where k='admin_a'));

select is(
  public.is_hotel_admin((select v from _t where k='hotel_a')),
  false,
  'hotel: is_hotel_admin returns false for the now-revoked admin'
);

-- ============================================================================
-- BUSINESS — seven tests (symmetric)
-- ============================================================================

-- T8. Dropped self_accept regression: symmetric to T1 but on business_users.
select _test_reset_role();
select _test_as_user((select v from _t where k='user_x'));

select throws_ok(
  format(
    $$update public.business_users
        set accepted_at = '1900-01-01 00:00:00+00'::timestamptz
      where user_id = %L$$,
    (select v from _t where k='user_x')
  ),
  null,
  null,
  'business: dropped self_accept means user cannot UPDATE their own accepted_at (column GRANT denies)'
);

-- T9. Non-admin member cannot revoke another member.

do $$
declare rc int;
begin
  update public.business_users
    set revoked_at = now(), revoked_by = (select v from _t where k='user_x')
    where user_id = (select v from _t where k='admin_x');
  get diagnostics rc = row_count;
  perform set_config('test.user_x_revoke_count', rc::text, true);
end;
$$;

select is(
  current_setting('test.user_x_revoke_count')::int,
  0,
  'business: non-admin member cannot revoke another member (RLS denies; 0 rows affected)'
);

-- T10. Business admin revokes a regular member.
select _test_reset_role();
select _test_as_user((select v from _t where k='admin_x'));

select lives_ok(
  format(
    $$update public.business_users
        set revoked_at = now(), revoked_by = %L
      where user_id = %L$$,
    (select v from _t where k='admin_x'),
    (select v from _t where k='user_x')
  ),
  'business: admin revokes a regular member (column GRANT + admin_revoke policy)'
);

-- T11. Revoked member fails is_business_user.
select _test_reset_role();
select _test_as_user((select v from _t where k='user_x'));

select is(
  public.is_business_user((select v from _t where k='biz_x')),
  false,
  'business: is_business_user returns false for the revoked member'
);

-- T12. Revoked member sees zero businesses under RLS.
select is(
  (select count(*)::int from public.businesses),
  0,
  'business: revoked member sees zero businesses (RLS treats them as non-member)'
);

-- T13. Service role can revoke an admin.
select _test_reset_role();
select _test_as_service();

select lives_ok(
  format(
    $$update public.business_users
        set revoked_at = now(), revoked_by = null
      where user_id = %L$$,
    (select v from _t where k='admin_x')
  ),
  'business: service_role revokes the admin (bypasses RLS and column GRANT)'
);

-- T14. Revoked admin fails is_business_admin.
select _test_reset_role();
select _test_as_user((select v from _t where k='admin_x'));

select is(
  public.is_business_admin((select v from _t where k='biz_x')),
  false,
  'business: is_business_admin returns false for the now-revoked admin'
);

select * from finish();

rollback;
