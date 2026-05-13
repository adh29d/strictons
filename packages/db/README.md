# @strictons/db

Database schema, RLS policies, generated types, and the typed Supabase client for the Strictons monorepo. **All Supabase access in any other package or app must go through this package** — apps never import `@supabase/supabase-js` directly.

## What's in here

```
packages/db/
├── supabase/
│   ├── config.toml          # Local CLI configuration (Postgres on 54322)
│   └── migrations/          # Ordered SQL migrations, append-only.
│                            #   Reference data (mood_options) lives here too,
│                            #   not in seed.sql, so `supabase db push` picks
│                            #   it up against hosted environments.
├── src/
│   ├── client.ts            # createServiceRoleClient() — server-side only
│   └── database.types.ts    # Auto-generated; regenerate after every migration
├── tests/
│   ├── _setup.sql           # Enables pgtap extension
│   ├── _helpers.sql         # Role impersonation + fixture seeders
│   └── *.spec.sql           # 10 pgTAP suites
├── scripts/
│   ├── seed.ts              # Auth-linked dev fixtures (runs against local only)
│   └── run-pgtap.mjs        # Test runner (uses pg_prove if available)
└── package.json             # All db scripts (db:start, db:reset, db:test, gen:types, db:seed)
```

## Local development

Prerequisites: Docker Desktop running. Everything else (Supabase CLI, Node 22, pnpm 10) is pinned in the monorepo.

```bash
pnpm install                                           # once
pnpm --filter @strictons/db db:start                   # boots local Supabase (~60s first time)
pnpm --filter @strictons/db db:reset                   # apply all migrations (incl. reference-data seed)
pnpm --filter @strictons/db gen:types                  # regenerate src/database.types.ts
SUPABASE_SECRET_KEY=$(pnpm --filter @strictons/db exec supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2 | tr -d '"') \
  pnpm --filter @strictons/db db:seed                  # auth-linked dev fixtures
pnpm --filter @strictons/db db:test                    # pgTAP suites
pnpm --filter @strictons/db db:stop                    # tear down
```

`db:reset` is destructive — it drops the local DB and re-applies every migration. Always safe locally; never run against dev or prod.

**Reference data lives in migrations, not in `seed.sql`.** Supabase's `db push` (used by the dev / prod deploy workflows) only applies migrations; `seed.sql` is local-only. Anything every environment needs (mood_options, future enum-backed taxonomies, etc.) must ship as a migration with `INSERT ... ON CONFLICT DO NOTHING` so it's idempotent and re-runnable. Auth-linked dev fixtures (test users, sample hotels) stay in `scripts/seed.ts` and only target local.

## Adding a migration

1. Create a new file under `supabase/migrations/` named `{YYYYMMDDHHMMSS}_{description}.sql`. Use `pnpm --filter @strictons/db exec supabase migration new <description>` to get a correct timestamp.
2. Write the migration. Schema conventions:
   - `id uuid primary key default gen_random_uuid()`
   - `created_at timestamptz not null default now()`
   - `updated_at timestamptz not null default now()` with a `before update ... execute function extensions.moddatetime(updated_at)` trigger
   - Money: `bigint`, suffixed `_cents`, `comment '... AUD inclusive of GST.'`
   - Use the existing enums (see `20260504100000_baseline.sql`); add new enums there if you need to extend
3. Define RLS policies in the same migration as the table. Conventions:
   - Hotel-scoped tables get `is_hotel_user(uuid)` / `is_hotel_admin(uuid)` predicates.
   - Business-scoped tables get `is_business_user(uuid)` / `is_business_admin(uuid)`.
   - Strictons all-access predicate is `is_strictons_staff()`.
   - Service-role-only mutations: don't create an INSERT/UPDATE/DELETE policy and ensure GRANTs are revoked from `authenticated`/`anon` where appropriate.
   - **Views need explicit revokes.** `revoke ... on all tables in schema public` does not reliably extend to views in Supabase's Postgres. When creating a view, also `revoke insert, update, delete on public.<view> from anon, authenticated` if the view is read-only (which most are).
4. Apply locally (`db:reset`) and run pgTAP (`db:test`) before committing.
5. Regenerate types (`gen:types`) and commit the result alongside the migration. CI's drift check fails the PR if you forget.
6. Add or update pgTAP suites under `tests/` if the migration introduces new RLS surface area.

**Migrations are append-only once they have successfully applied to any shared environment** (CI green, dev, or prod). After that point, never edit the migration file — fix-forward only by adding a new migration that corrects the schema. The dev environment is recreated on every push to `main`; prod uses Supabase PITR backups for recovery.

**Carve-out: a migration that has never reached green CI may still be edited on its branch**, because no environment has been affected by it and there is nothing to preserve. The discipline protects migrations whose effects exist somewhere; a migration whose effects exist nowhere has not yet earned that protection. Document the edit in the commit message so the reasoning is visible in `git log`.

## Generated TypeScript types

`src/database.types.ts` is the canonical type surface for the Supabase schema. Apps consume it via:

```ts
import type { Database } from '@strictons/db/types';
```

Regenerate after every migration:

```bash
pnpm --filter @strictons/db gen:types
```

CI verifies zero drift between the committed file and what `supabase gen types typescript --local` produces.

## Service-role client

Server-side code (Server Components, Route Handlers, Server Actions, background scripts) reaches the database via:

```ts
import { createServiceRoleClient } from '@strictons/db/client';

const db = createServiceRoleClient();
const { data } = await db.from('hotels').select('*').eq('slug', 'beachcomber');
```

This bypasses RLS. **Never import this from a `'use client'` module** — it would inline `SUPABASE_SECRET_KEY` into the browser bundle. The function header carries an extended warning to that effect.

The Phase 3 work will add `createBrowserClient()` and `createServerClient()` for SSR-cookie-aware authenticated user clients (RLS-enforced, magic-link backed).

## Environment variables

| Name                                   | Used by                         | Where                     |
| -------------------------------------- | ------------------------------- | ------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Apps (browser + server)         | `.env.local`, Vercel      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Apps (browser, RLS-enforced)    | Vercel shared env         |
| `SUPABASE_SECRET_KEY`                  | Server-side only (bypasses RLS) | Vercel per-project secret |
| `SUPABASE_DB_URL_DEV`                  | CI dev migration job            | GH repo secret            |
| `SUPABASE_DB_URL_PROD`                 | CI prod migration job           | GH repo secret (Phase 7+) |

The publishable / secret naming follows Supabase's November 2025 migration off legacy JWT keys. Functional behaviour is unchanged: publishable acts as the public client key (RLS-enforced); secret bypasses RLS for server-side use.

## RLS reference

| Cluster        | Tables                                                                   | Read pattern                                                          | Write pattern                                                                                                                               |
| -------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth           | `users`, `strictons_staff`                                               | own row + staff                                                       | display_name only by self; staff via service role                                                                                           |
| Hotels         | `hotels`, `hotel_users`, `guides`, `print_change_requests`               | members of own hotel + staff                                          | hotel_admin manages members + contact_email; rest service-role                                                                              |
| Businesses     | `businesses`, `business_users`                                           | members of own business + hotel-via-placement + staff                 | business_admin manages listing-editable fields + members                                                                                    |
| Contracts      | `ad_placements`, `ad_revisions`, `self_supplied_ads`, `quality_concerns` | both sides + staff                                                    | service-role only (except self-supplied upload by business_admin and quality concerns INSERT by hotel_admin with status='review_requested') |
| Candidate list | `candidate_businesses`                                                   | hotel + staff                                                         | Strictons INSERT; hotel_admin status to approved/removed_by_hotel; signed_to_placement Strictons-only                                       |
| Briefs         | `briefs`, `brief_assets`, `mood_options`, `brief_mood_selections`        | business + staff (mood_options visible to all authenticated)          | business_admin while editable; mood_options service-role only                                                                               |
| Analytics      | `qr_codes`, `events`, `events_hourly`/`_daily`/`_monthly`                | qr_codes hotel-scoped; events Strictons-only; rollups scoped per side | INSERT all service-role; events UPDATE/DELETE never                                                                                         |
| Audit          | `audit_log`                                                              | scope-by-entity_hotel_id / entity_business_id; staff sees all         | INSERT service-role only; UPDATE/DELETE never (trigger-blocked)                                                                             |

For the canonical RLS surface, read the migration files in order. Each cluster migration defines its tables and policies in one file.

## CI workflows

Three workflows under `.github/workflows/`:

- **`db-test.yml`** — runs on PRs and pushes to `main` touching `packages/db/**`. Boots local Supabase, runs the 10 pgTAP suites, regenerates types, and fails on drift.
- **`db-deploy-dev.yml`** — runs on push to `main` touching `packages/db/supabase/**`. Applies migrations to `strictons-dev` automatically. Requires repo secret `SUPABASE_DB_URL_DEV`.
- **`db-deploy-prod.yml`** — manual `workflow_dispatch` only. Two-job pipeline: diff (posts the SQL diff into the workflow summary, no DB writes) → push (gated by GitHub Environment `production-database` with required reviewers).

## Provisioning prod (run when Phase 7 or 8 needs it)

The prod-deploy workflow is inert until provisioning is complete.

1. **Create the Supabase project** at https://supabase.com/dashboard. Name: `strictons-prod`. Region: AU (closest to guest population).
2. **Copy the connection string** from Settings → Database → Connection string (Direct connection, NOT Supabase pooler — the CLI requires direct).
3. **Add as repo secret** `SUPABASE_DB_URL_PROD` under GitHub repo Settings → Secrets and variables → Actions → New repository secret.
4. **Create the GitHub Environment** named `production-database` under Settings → Environments → New environment. Add yourself (and any co-deployers) as required reviewers. Optionally restrict to `main` branch.
5. **Dispatch a dry-run** of `db-deploy-prod.yml` with confirm string `"deploy to prod"` to verify the diff job runs cleanly. The push job will pause for approval; you can cancel without applying.
6. **Apply the baseline** by dispatching the workflow again, this time letting the push job proceed through approval. After this, every subsequent dispatch applies only new migrations.

## Provisioning a Strictons staff user (run once per new staff member)

Strictons staff are members of `public.strictons_staff`. The table's write side is service-role only (Phase 2 locked decision; no `FOR ALL to authenticated using is_strictons_staff()` write policy exists), so a new staff user is created out-of-band via this runbook rather than from inside any app.

Phase 4 commit 7 introduces this runbook. The **first** execution provisions Steven's own real staff user and, as its final step, removes the Phase 3 test data (`dev-test@strictons.com`, "Test Beachcomber Hotel", and the membership rows linking them). That cleanup runs once, during the first staff provisioning, to prove the runbook works before any future staff provisioning relies on it.

The runbook targets `strictons-dev`. For `strictons-prod` once that exists, the steps are identical — just point at the prod project's Supabase Dashboard.

### Steps

1. **Open the target Supabase project** in the Dashboard (https://supabase.com/dashboard). For Phase 4, this is `strictons-dev`.

2. **Create the auth.users row via the Dashboard.** Authentication → Users → Add user → Send invitation. Enter the staff member's email. Check **Auto Confirm User** so they don't need to click a Supabase-templated confirmation email — we ship our own magic links from `welcome@strictons.com` via SendGrid, so the Supabase default email is disabled.

   Do NOT INSERT into `auth.users` via SQL. The auth schema is managed by GoTrue and direct INSERTs skip the password / metadata defaults GoTrue expects. The Dashboard's "Add user" flow is the supported path.

   Important — Phase 2 ordering gotcha: when an auth.users row is created (via Dashboard, API, or the supported admin endpoints), the `on_auth_user_created` trigger (`SECURITY DEFINER`) AUTO-POPULATES the corresponding `public.users` row. **Never INSERT into `public.users` manually after this step.** Doing so would double-insert and either error on the primary key conflict or, worse, race the trigger.

3. **Copy the new user's `id`** from the Dashboard's Users list (it's a UUID).

4. **Insert into `public.strictons_staff`** via SQL Editor:

   ```sql
   insert into public.strictons_staff (user_id)
   values ('<paste-user-id-here>')
   on conflict (user_id) do nothing;
   ```

   `on conflict do nothing` makes the statement idempotent — re-running with the same id is a no-op rather than an error. Strictons-side writes to this table always run via the service-role / SQL Editor path, never from inside any app, so RLS does not gate this INSERT.

5. **(Optional) Notify PostgREST of the schema reload** in case the staff status is not visible to the new user's first sign-in:

   ```sql
   notify pgrst, 'reload schema';
   ```

   Usually unnecessary for a row INSERT (vs a column or policy change), but the cost is zero and the symptom this prevents — first-sign-in `isStrictonsStaff: false` until the next reload — is hard to diagnose.

6. **Verify the staff user can sign in.** Navigate to the admin app preview URL (or `admin.strictons.com` for production). Enter the staff member's email. Receive the magic link. Click it. Expected behaviour:

   - `/auth/confirm` accepts the token and establishes the session
   - Middleware reads `isStrictonsStaff: true` (commit 5's real query) and lets the request through
   - The landing page at `/` renders with the staff member's email in the "Signed in as …" line
   - The page is NOT `/no-access`

   If the user lands on `/no-access`, the insertion into `public.strictons_staff` didn't apply or PostgREST hasn't reloaded the schema yet. Re-run step 5, then sign out and back in.

7. **Confirm sign-out works.** Click "Sign out" on the landing. Expected: redirected to `/sign-in`. Visiting `/` after sign-out redirects back to `/sign-in?next=%2F`.

### Final step (FIRST RUN ONLY) — remove the Phase 3 test data

This step runs only during the first staff user's provisioning, to prove the runbook works end-to-end before any future staff user depends on it. Subsequent runs skip this entire section.

`dev-test@strictons.com` and "Test Beachcomber Hotel" were inserted via SQL Editor during Phase 3 commit-15 verification. Phase 3's PROJECT_LOG explicitly deferred their cleanup to this runbook.

#### Why the test hotel row is NOT deleted

Phase 2's locked decision makes `public.audit_log` append-only via a trigger blocking UPDATE and DELETE for every role (including service_role). The FK from `audit_log.entity_hotel_id` → `hotels.id` is `ON DELETE SET NULL`, which requires Postgres to UPDATE the audit rows whenever the referenced hotel is deleted. The trigger blocks that UPDATE, and the entire `DELETE FROM public.hotels` transaction rolls back with:

```
ERROR: audit_log is append-only; UPDATE not permitted
SQL statement "UPDATE ONLY "public"."audit_log" SET "entity_hotel_id" = NULL WHERE $1 OPERATOR(pg_catalog.=) "entity_hotel_id""
```

This is correct behaviour — the audit trail is meant to outlast the entities it references. The runbook adapts: the test hotel row stays in place. After this cleanup, "Test Beachcomber Hotel" is an orphan record — no `hotel_users` link it to anyone, no business records reference it, and no future audit rows can be written against it because no app surface mentions it. Future audit queries that need to filter to "real hotels" can exclude test rows by slug prefix (e.g. `where slug not like 'test-%'`).

#### Why the test user row is NOT deleted

The same trigger + FK pattern blocks the user delete by a longer path. Cascade trace:

1. `auth.users` delete →
2. `public.users` delete (via `users_id_fkey` ON DELETE CASCADE) →
3. `public.audit_log` UPDATE (via `audit_log_actor_user_id_fkey` ON DELETE SET NULL) →
4. blocked by `enforce_audit_log_append_only()` trigger →
5. transaction rolls back.

The Dashboard surfaces this as a generic `"Database error deleting user"`. The diagnostic query is:

```sql
-- All FKs into public.users.id, with their ON DELETE action.
select tc.constraint_name, tc.table_name, rc.delete_rule
from information_schema.referential_constraints rc
join information_schema.table_constraints tc
  on tc.constraint_name = rc.constraint_name
where rc.unique_constraint_name in (
  select constraint_name from information_schema.table_constraints
  where table_schema = 'public' and table_name = 'users'
    and constraint_type = 'PRIMARY KEY'
);
```

The result: **eleven of the twelve FKs from public tables into `public.users.id` are `ON DELETE SET NULL`** (only `strictons_staff.user_id` is `CASCADE`). Any user who has performed an audit-logged action — which includes every user who has signed in, since `/auth/confirm` writes `sign_in_succeeded` — has audit history and is effectively undeletable. `dev-test@strictons.com` has signed in, so it cannot be deleted.

The mechanism for users mirrors the mechanism for entities: deactivate, don't delete.

#### Broader implication

This constraint applies to **any** audit-linked row, not just hotels:

- `hotels` (`audit_log.entity_hotel_id`)
- `businesses` (`audit_log.entity_business_id`)
- `users` (`audit_log.actor_user_id`)
- `candidate_businesses` (when an audit entry has referenced them — same SET NULL pattern)

Phase 5+ deactivation UX is uniformly **soft-delete (a flag) or `banned_until`** for every audited row type, never a hard DELETE. The audit log's reach is wider than just entity tables — it extends through every FK pointing at any audited row, including users in `public.users`.

#### Steps

Two SQL statements; no Dashboard delete.

1. **Ban the test auth user.** Supabase's `auth.users` table has a `banned_until` column; setting a far-future value invalidates the user without requiring a DELETE. Two paths:

   - **Supabase Dashboard** (preferred when available): Authentication → Users → row action menu → "Ban user". If the Dashboard build doesn't surface this action, use the SQL fallback below.
   - **SQL Editor** (fallback):

     ```sql
     update auth.users
     set banned_until = '2099-12-31 23:59:59+00'
     where email = 'dev-test@strictons.com';
     ```

   `banned_until` in the far future is the documented Supabase "permanent ban" idiom. `auth.users` UPDATE has no FK cascade into `audit_log` — only DELETE on `public.users` triggers the SET NULL path — so this statement succeeds cleanly.

2. **Remove the test user's hotel memberships.** Deleting from `public.hotel_users` does NOT cascade through `audit_log` (`audit_log.entity_id` is a generic uuid with no FK enforcement; `audit_log` has no direct FK pointing at `hotel_users.id`). The DELETE succeeds:

   ```sql
   delete from public.hotel_users
   where invited_email = 'dev-test@strictons.com';
   ```

   This removes both the original Phase 3 invite (`user_id IS NULL`) and the accepted row that resulted from the first magic-link sign-in (`user_id` set to dev-test's auth id).

   No DELETE on `public.hotels` or `public.users` — see the two "Why the … row is NOT deleted" sections above.

#### Verify

- **Sign-in fails.** Submit `dev-test@strictons.com` on the partners or admin sign-in form. The magic-link request submits successfully (anti-enumeration — Phase 3 locked decision), but the link itself cannot complete sign-in. **Verify whether Supabase Auth's `verifyOtp` rejects the banned user cleanly:**
  - Expected: the `/auth/confirm` handler receives an error from `verifyOtp` and redirects to `/sign-in?error=expired`.
  - **[FOLLOWUP]** If `verifyOtp` does NOT reject a banned user and a session is established, flag for separate investigation. The defence-in-depth at that point is the `/no-access` redirect (dev-test has no staff row and post-cleanup has no hotel memberships either, so the partners predicate routes to `/no-access` regardless). But a banned-user verifyOtp bypass would be a real Supabase Auth bug worth raising upstream.
- `select banned_until from auth.users where email = 'dev-test@strictons.com'` returns the far-future timestamp.
- `select count(*) from public.hotel_users where invited_email = 'dev-test@strictons.com'` returns 0.
- `select id, slug, name from public.hotels where slug = 'test-beachcomber'` still returns the row — that's intentional. Confirm there are no `hotel_users` references: `select count(*) from public.hotel_users where hotel_id = (select id from public.hotels where slug = 'test-beachcomber')` returns 0.
- `select email from public.users where email = 'dev-test@strictons.com'` still returns the row — also intentional. The user is banned at the auth layer but the `public.users` row remains because every audit-history reference to its `id` would otherwise break.

#### End-state summary

After this cleanup, the strictons-dev project contains:

- **Test hotel**: present in `public.hotels`, orphaned (no `hotel_users` references, no businesses, no app surface mentions it).
- **Test user**: present in `auth.users` with `banned_until` set far-future; present in `public.users` with audit history intact; cannot complete sign-in.
- **Test memberships**: gone (the explicit DELETE in step 2 removed them, since `hotel_users` deletes don't cascade through audit_log).

Once verified, this section of the runbook is done forever. Subsequent staff provisioning skips it.

## Phase 2 status

Done. Schema covers every cluster called out in the brief plus the locked decisions (custom_domain on hotels, guides as analytics scope, audit_log denormalised columns, append-only triggers, premium-position uniqueness, print-state immutability, geo_confirmed reserved enum value, etc.). 10 pgTAP suites cover unauth, staff, hotel/business isolation, audit append-only, quality-clause, cross-tenant writes, service-role reads, print-state immutability, and premium-position uniqueness.

Phase 3 will land the magic-link auth flow (`createBrowserClient`, `createServerClient`, `packages/email`, `packages/types` with Zod schemas for `briefs.data`).
