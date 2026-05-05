-- ============================================================================
-- Add function-backed CHECK on businesses.social_handles.
-- ----------------------------------------------------------------------------
-- The CHECK that was originally written inline in 20260504100300_businesses.sql
-- contained a subquery (SELECT bool_and(...) FROM jsonb_each(...)) which
-- Postgres rejects with SQLSTATE 0A000. The inline CHECK was removed from
-- that migration on the same branch (justified because it had never
-- successfully applied anywhere; see packages/db/README.md for the rule).
--
-- This migration restores equivalent validation by extracting the predicate
-- into an IMMUTABLE SQL function which the CHECK references. A function
-- call is permitted in a CHECK; a subquery is not.
-- ============================================================================

create or replace function public.is_valid_social_handles(p_handles jsonb)
returns boolean
language sql
immutable
as $$
  select
    jsonb_typeof(p_handles) = 'object'
    and not exists (
      select 1
      from jsonb_each(p_handles) as e(key, value)
      where e.key not in ('instagram', 'facebook', 'tiktok', 'other')
         or jsonb_typeof(e.value) <> 'string'
    );
$$;

comment on function public.is_valid_social_handles(jsonb) is
  'True when input jsonb is an object whose keys are all in {instagram, facebook, tiktok, other} and whose values are all strings. IMMUTABLE so it can be referenced from CHECK constraints.';

alter table public.businesses
  add constraint businesses_social_handles_valid
  check (public.is_valid_social_handles(social_handles));
