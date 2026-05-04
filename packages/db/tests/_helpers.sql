-- ============================================================================
-- Test helpers — role impersonation + small fixture seeders.
-- Run once, after _setup.sql and before the first *.spec.sql.
--
-- Function names are prefixed with `_test_` so they cannot be confused with
-- application functions. They live in the public schema for ease of access
-- from test files.
-- ============================================================================

-- ---- Role impersonation ----------------------------------------------------

create or replace function _test_as_user(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end;
$$;
comment on function _test_as_user(uuid) is 'Switch to authenticated role with the given auth.uid().';

create or replace function _test_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;
comment on function _test_as_anon() is 'Switch to anonymous (unauthenticated) role.';

create or replace function _test_as_service()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'service_role', true);
end;
$$;
comment on function _test_as_service() is 'Switch to service_role (bypasses RLS).';

create or replace function _test_reset_role()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;
comment on function _test_reset_role() is 'Restore postgres superuser role for fixture setup.';

-- ---- Minimal fixture seeders ----------------------------------------------
-- Each seeder returns a record of the IDs it created so tests can use them.
-- All seeders run as postgres (caller responsible for resetting role first)
-- and assume an empty transaction (use BEGIN/ROLLBACK around tests).

create or replace function _test_seed_user(p_email text)
returns uuid
language plpgsql
as $$
declare
  new_user_id uuid := gen_random_uuid();
begin
  -- Bypass auth.users for tests; insert directly into public.users (RLS
  -- bypassed because we're running as postgres). Real auth.users insertion
  -- via supabase.auth.admin.createUser() is exercised by integration tests
  -- in Phase 3.
  insert into public.users (id, email) values (new_user_id, p_email);
  return new_user_id;
end;
$$;

create or replace function _test_seed_strictons_staff(p_email text)
returns uuid
language plpgsql
as $$
declare
  uid uuid := _test_seed_user(p_email);
begin
  insert into public.strictons_staff (user_id) values (uid);
  return uid;
end;
$$;

create or replace function _test_seed_hotel(p_slug text, p_name text)
returns uuid
language plpgsql
as $$
declare
  hid uuid := gen_random_uuid();
begin
  insert into public.hotels (id, slug, name, contact_email)
  values (hid, p_slug, p_name, p_slug || '@example.test');
  return hid;
end;
$$;

create or replace function _test_seed_hotel_admin(p_hotel_id uuid, p_email text)
returns uuid
language plpgsql
as $$
declare
  uid uuid := _test_seed_user(p_email);
begin
  insert into public.hotel_users (hotel_id, user_id, invited_email, accepted_at)
  values (p_hotel_id, uid, p_email, now());
  -- The first-invitee trigger may have already set is_admin true; force it
  -- here in case this isn't the first invitee for the hotel in test setup.
  update public.hotel_users
    set is_admin = true
    where hotel_id = p_hotel_id and user_id = uid;
  return uid;
end;
$$;

create or replace function _test_seed_business(p_legal_name text)
returns uuid
language plpgsql
as $$
declare
  bid uuid := gen_random_uuid();
begin
  insert into public.businesses (id, legal_name, display_name)
  values (bid, p_legal_name, p_legal_name);
  return bid;
end;
$$;

create or replace function _test_seed_business_admin(p_business_id uuid, p_email text)
returns uuid
language plpgsql
as $$
declare
  uid uuid := _test_seed_user(p_email);
begin
  insert into public.business_users (business_id, user_id, invited_email, accepted_at)
  values (p_business_id, uid, p_email, now());
  update public.business_users
    set is_admin = true
    where business_id = p_business_id and user_id = uid;
  return uid;
end;
$$;

create or replace function _test_seed_guide(p_hotel_id uuid)
returns uuid
language plpgsql
as $$
declare
  gid uuid := gen_random_uuid();
begin
  insert into public.guides (id, hotel_id, term_starts_on, term_ends_on)
  values (gid, p_hotel_id, current_date, current_date + interval '365 days');
  return gid;
end;
$$;
