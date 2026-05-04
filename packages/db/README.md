# @strictons/db

Database schema, RLS policies, generated types, and the typed Supabase client for the Strictons monorepo. **All Supabase access in any other package or app must go through this package** — apps never import `@supabase/supabase-js` directly.

## What's in here

```
packages/db/
├── supabase/
│   ├── config.toml          # Local CLI configuration (Postgres on 54322)
│   ├── migrations/          # Ordered SQL migrations, append-only
│   └── seed.sql             # Static reference data (mood_options) — auto-applied
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
pnpm --filter @strictons/db db:reset                   # apply migrations + seed.sql
pnpm --filter @strictons/db gen:types                  # regenerate src/database.types.ts
SUPABASE_SECRET_KEY=$(pnpm --filter @strictons/db exec supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2 | tr -d '"') \
  pnpm --filter @strictons/db db:seed                  # auth-linked dev fixtures
pnpm --filter @strictons/db db:test                    # pgTAP suites
pnpm --filter @strictons/db db:stop                    # tear down
```

`db:reset` is destructive — it drops the local DB and re-applies all migrations + `seed.sql`. Always safe locally; never run against dev or prod.

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
4. Apply locally (`db:reset`) and run pgTAP (`db:test`) before committing.
5. Regenerate types (`gen:types`) and commit the result alongside the migration. CI's drift check fails the PR if you forget.
6. Add or update pgTAP suites under `tests/` if the migration introduces new RLS surface area.

**Migrations are append-only.** Never edit a migration that has merged to `main`. Fix-forward only — write a new migration that corrects the schema. The dev environment is recreated on every push to `main`; prod uses Supabase PITR backups for recovery.

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

## Phase 2 status

Done. Schema covers every cluster called out in the brief plus the locked decisions (custom_domain on hotels, guides as analytics scope, audit_log denormalised columns, append-only triggers, premium-position uniqueness, print-state immutability, geo_confirmed reserved enum value, etc.). 10 pgTAP suites cover unauth, staff, hotel/business isolation, audit append-only, quality-clause, cross-tenant writes, service-role reads, print-state immutability, and premium-position uniqueness.

Phase 3 will land the magic-link auth flow (`createBrowserClient`, `createServerClient`, `packages/email`, `packages/types` with Zod schemas for `briefs.data`).
