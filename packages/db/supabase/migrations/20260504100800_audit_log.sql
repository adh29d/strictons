-- ============================================================================
-- Cluster H — audit_log
-- ----------------------------------------------------------------------------
-- Single append-only table per locked decision. Denormalised scope columns
-- (entity_hotel_id, entity_business_id) are populated by the app on insert
-- so the per-side SELECT policies are O(1) without joining on entity_type.
--
-- Quality concerns specifically populate BOTH scope columns (hotel + business)
-- so both sides see the audit entry — a property the application code must
-- enforce, since the schema can't tell which entity_types are "shared".
-- ============================================================================

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),

  actor_user_id uuid references public.users(id) on delete set null,
  actor_role public.actor_role not null,

  action text not null check (length(trim(action)) > 0),
  entity_type text not null check (length(trim(entity_type)) > 0),
  entity_id uuid not null,

  before jsonb,
  after jsonb,

  -- Denormalised scope columns. Set by the app at insert time so per-side
  -- SELECT policies don't need entity-type-specific joins.
  -- Either may be null when the entry pertains only to staff-internal state.
  entity_hotel_id uuid references public.hotels(id) on delete set null,
  entity_business_id uuid references public.businesses(id) on delete set null,

  occurred_at timestamptz not null default now()
);

create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, occurred_at);
create index audit_log_hotel_scope_idx
  on public.audit_log (entity_hotel_id, occurred_at)
  where entity_hotel_id is not null;
create index audit_log_business_scope_idx
  on public.audit_log (entity_business_id, occurred_at)
  where entity_business_id is not null;
create index audit_log_actor_idx
  on public.audit_log (actor_user_id, occurred_at)
  where actor_user_id is not null;

-- ---- Append-only enforcement -----------------------------------------------
-- Triggers fire ahead of any UPDATE or DELETE regardless of role, including
-- service role (which bypasses RLS but not BEFORE triggers).

create or replace function public.enforce_audit_log_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only; % not permitted', tg_op;
end;
$$;

create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function public.enforce_audit_log_append_only();

create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.enforce_audit_log_append_only();

-- ---- RLS -------------------------------------------------------------------

alter table public.audit_log enable row level security;

create policy "audit_log_select_strictons"
  on public.audit_log for select to authenticated
  using (public.is_strictons_staff());

create policy "audit_log_select_hotel_scope"
  on public.audit_log for select to authenticated
  using (
    entity_hotel_id is not null
    and public.is_hotel_user(entity_hotel_id)
  );

create policy "audit_log_select_business_scope"
  on public.audit_log for select to authenticated
  using (
    entity_business_id is not null
    and public.is_business_user(entity_business_id)
  );

-- INSERT: service-role only. Authenticated and anon never INSERT directly;
-- application code uses the service-role client to record audit entries
-- alongside the originating mutation in a single transaction.
revoke insert, update, delete on public.audit_log from authenticated, anon;
