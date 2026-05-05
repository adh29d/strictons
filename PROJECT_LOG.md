# Strictons project log

Phase-organised running record of what landed, what we decided, and what surprised us. Maintained at the end of each phase per the convention in `CLAUDE.md`. Append a new section when a phase merges to `main` and is verified live; do not retroactively edit older entries.

This is the lived-experience companion to `git log` — the latter records what changed, this records what we learned doing it.

---

## Phase 1 — Monorepo foundation (merged 2026-05-04)

### What landed

- pnpm 10 workspace with Turborepo task pipeline. Node 22 LTS pinned via `.nvmrc` + `packageManager` field in root `package.json`.
- Strict TypeScript everywhere (`noUncheckedIndexedAccess`, `noImplicitOverride`, `no-explicit-any` enforced via lint).
- Three shared config packages under `packages/config/`: `@strictons/config-eslint` (flat config base + Next.js preset, `no-explicit-any` rule), `@strictons/config-tsconfig` (base / nextjs / react-library), `@strictons/config-tailwind` (Tailwind v4 design tokens via CSS-first `theme.css`).
- Two placeholder shared packages: `@strictons/ui` (one `AppShell` component used by every app to verify cross-package imports), `@strictons/types` (placeholder for shared TS types).
- Four Next.js 15 App Router apps on staggered ports so `pnpm dev` doesn't collide: `marketing` (3000), `admin` (3001), `partners` (3002), `mystay` (3003). Each renders the placeholder `AppShell`.
- GitHub Actions CI: `pnpm format:check`, then `pnpm turbo run typecheck lint build`.
- Repo root README with the Vercel four-projects-from-one-repo runbook (separate Vercel project per app, root directory `apps/<name>`, build via Turborepo `--filter` syntax, env-var split between Vercel team-level shared secrets and per-project app-specific values).

### Locked decisions

- **Each app/package owns its own `eslint.config.mjs` consuming the shared preset.** No monolithic root config that knows about every workspace; the root config lints repo-level files only.
- **`packages/config` is a namespace dir, not a single workspace package.** Three separate packages live underneath (`config-eslint`, `config-tsconfig`, `config-tailwind`) because their dependency graphs differ — only `config-eslint` pulls in plugins. `pnpm-workspace.yaml` includes `packages/config/*` so the nested layout works.
- **App ports staggered 3000-3003** so `pnpm dev` running all four apps in parallel doesn't collide.
- **Vercel topology: four separate Vercel projects, one per app, all from this repo.** Lets us attach hotel custom domains only to the `mystay` project, deploy apps independently, and keep env-var blast radius small. The runbook is in `README.md`.
- **Tailwind v4 with CSS-first config.** Shared design tokens live in a single `@theme` block in `packages/config/tailwind/theme.css`; apps `@import` it from `globals.css` after `@import "tailwindcss"`. No `tailwind.config.{js,ts}` files in apps.
- **Sentry SDK NOT wired in Phase 1.** Env-var slot documented in each `.env.example`, real wiring deferred until there are surfaces to instrument.

### Gotchas

- **`next-env.d.ts` is auto-generated** with a triple-slash reference that fails `@typescript-eslint/triple-slash-reference`. Fix: gitignore the file + add `**/next-env.d.ts` to the shared next eslint preset's `ignores`. Discovered when the marketing app's lint started failing after the second app was added.
- **`sharp` postinstall is ignored by pnpm 10** (default-deny on build scripts). Native bindings would speed up Next image optimisation but aren't required. Deferred — added to root `package.json` `pnpm.onlyBuiltDependencies` as a known-future safelist candidate, not enabled yet.
- **`next build` emits "The Next.js plugin was not detected in your ESLint configuration"** — cosmetic warning from `next build`'s legacy-config sniffer. The plugin IS loaded via flat config; the warning doesn't reflect actual lint behaviour. Safe to ignore until Next's CLI catches up to flat config.

### What's deferred

- Sentry SDK instrumentation (env slot present, real wiring later).
- Custom hotel domain attachment to the `mystay` Vercel project (runbook in repo root README; not exercised until a hotel asks).

---

## Phase 2 — Database & RLS skeleton (merged 2026-05-05)

### What landed

- Thirteen SQL migrations under `packages/db/supabase/migrations/`: `baseline` (extensions, 19 enums with the hotel-approval state-machine doc as a comment block, helper functions), eight cluster migrations covering every table from the brief (users + strictons_staff, hotels cluster, businesses cluster, ad_placements cluster, candidate_businesses, briefs cluster, qr_codes + events + rollup skeletons, audit_log), and four fix-forward migrations (function-backed `social_handles` CHECK, anon write revoke, authenticated write revoke, view write revoke).
- `@strictons/db` package: `createServiceRoleClient()` with explicit "server-side only" header comment, generated `database.types.ts` (1461 lines, scoped to `public` schema), Supabase CLI pinned as a dev dependency.
- pgTAP harness (`_setup.sql` + `_helpers.sql` with role-impersonation and fixture seeders) plus 10 spec files: unauth + structural audit, Strictons staff, hotel and business isolation, audit append-only, quality clause, cross-tenant writes, service-role reads, print-state immutability, premium-position uniqueness.
- Three CI workflows: `db-test.yml` (boot local Supabase → regenerate types → drift check → pgTAP suites; ordered so types generation runs before pgTAP installs to avoid extension pollution), `db-deploy-dev.yml` (auto-apply on push to main), `db-deploy-prod.yml` (manual `workflow_dispatch` only, two-stage diff→push gated by GitHub Environment with required reviewers; inert until prod is provisioned).
- Reference data (mood_options) ships as a migration in a Phase 2 follow-up PR (#4) so `db push` against hosted environments picks it up. Auth-linked dev fixtures stay in `scripts/seed.ts` (local only).
- `packages/db/README.md` documents the layout, migration-authoring conventions, type regeneration, service-role client usage, env-var matrix (with the November 2025 Supabase API key naming: `SUPABASE_SECRET_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), and the prod provisioning runbook.

### Locked decisions

- **All Supabase access goes through `@strictons/db`.** Apps never import `@supabase/supabase-js` directly. The package is the only seam; helpers and clients live there.
- **Service-role client (`createServiceRoleClient()`) is server-side only.** Multi-line warning comment on the function forbids importing from any `'use client'` module — doing so would inline `SUPABASE_SECRET_KEY` into the browser bundle. Allowed callers: Server Components, Route Handlers, Server Actions, background scripts.
- **Migrations are append-only once they have successfully applied to any shared environment** (green CI, dev, or prod). Edit-in-place is permitted only on a branch where CI has not yet gone green for that migration — there is no environment to preserve. Documented in `packages/db/README.md` with rationale.
- **Reference data ships as a migration with `INSERT ... ON CONFLICT DO NOTHING`, not in `seed.sql`.** `supabase db push` does not apply `seed.sql`; only `supabase db reset` does. Anything every environment needs goes in a migration. Auth-linked dev fixtures (test users, sample hotels) stay in `scripts/seed.ts` and only target local.
- **Views need explicit `revoke insert, update, delete from anon, authenticated`.** The `revoke … on all tables in schema public` form does not reliably extend to views in Supabase's Postgres. Documented in the migration-authoring checklist.
- **`alter default privileges in schema public revoke …` is set for both `anon` and `authenticated`** so future public tables inherit no-write defaults. Migrations that need an authenticated write path on a new table must add an explicit GRANT.
- **Strictons writes route through the service-role client.** No `FOR ALL to authenticated using is_strictons_staff()` policies on Strictons-only tables (`guides`, `print_change_requests`, `candidate_businesses` — the three FOR ALL bypasses dropped during the security audit). Strictons admin-side mutations use the service-role client server-side. Phase 4+ admin app code is consistent with this.
- **pgTAP types must be excluded from generated types via CI ordering.** `gen:types` runs *before* the test runner installs pgTAP into `public`. The schema flag (`--schema public`) does not filter extension-owned objects in our pg-meta version, so ordering is the actual fix.
- **The structural audit query in `tests/01_unauth.spec.sql` (test 21) is the canonical backstop for orphan GRANTs going forward.** Joins `information_schema.role_table_grants` against `pg_policies`, excludes extension-owned objects via `pg_depend`. Counts (table, role, privilege) tuples that have a write GRANT to anon or authenticated with no backing RLS policy permitting that role + operation. Catches new tables added in later phases automatically.

### Gotchas

- **SQLSTATE 0A000 — "cannot use subquery in check constraint."** Postgres rejects any subquery (including SELECT … FROM jsonb_each(…)) inside a CHECK. Wrap the predicate in an `IMMUTABLE` SQL function and reference the function from the CHECK. Bit us on `businesses.social_handles` validation; fix-forward migration `20260504100900_add_social_handles_check.sql` introduced `is_valid_social_handles(jsonb)`.
- **Silent zero rows on UPDATE / DELETE under RLS.** When no policy matches the calling role, INSERT raises (WITH CHECK is mandatory) but UPDATE / DELETE return zero rows with no error. Combined with Supabase's default GRANT-ALL machinery, anon and authenticated could issue write statements that succeed silently against tables they have no policy on. Fix: pair RLS with explicit `revoke insert, update, delete from anon` (blanket-safe) and per-table `revoke` from `authenticated` where no policy permits, plus `alter default privileges` for future tables. The pattern is now codified in the structural audit (test 21).
- **Hosted Supabase direct connections are IPv6-only; GitHub Actions runners have no IPv6.** Migrations from CI must use the **session pooler** connection string for both `SUPABASE_DB_URL_DEV` and `SUPABASE_DB_URL_PROD`, not the "direct connection" string from Settings → Database. The session pooler is IPv4-reachable and accepts the same migration commands.
- **`supabase db push` does not apply `seed.sql`; only `supabase db reset` does.** Reference data shipped only in `seed.sql` will be missing from dev / prod. Reference data must ship as a migration (see locked decisions).
- **pgTAP installs auxiliary objects (`tap_funky`, `pg_all_foreign_keys`) into the `public` schema.** Without filtering, these leak into the generated types AND show up as orphan GRANTs in the structural audit. Fix: in audits, exclude extension-owned objects via `pg_depend` (`classid = 'pg_class'::regclass AND refclassid = 'pg_extension'::regclass AND deptype = 'e'`); for type generation, run `gen:types` before pgTAP is installed in CI.
- **Temp tables across role switches need `grant select, insert on _t to public`.** Postgres's default temp-table ACL grants access only to the creating role. pgTAP suites that `_test_as_user(...)` or `_test_as_service()` and then read a temp table fail with `permission denied for table _t` without the explicit grant. Cleaner long-term fix: avoid temp tables in role-switching suites entirely (suite 09 already does, using a `DO` block + PL/pgSQL variables).
- **`auth.users` vs `public.users` ordering.** Test fixtures must seed `auth.users` first to satisfy the FK from `public.users.id`. The `on_auth_user_created` trigger (`SECURITY DEFINER`) handles the `public.users` insert automatically — seeders should only insert into `auth.users` and never double-insert.
- **`information_schema.role_table_grants` reports a row per table when ANY column has the privilege, including views and column-level grants.** When auditing, expect column-restricted UPDATEs (e.g. `hotels.contact_email`) to appear at the table level — back-check via `pg_policies` to confirm a policy permits the role, not just by counting rows.
- **`pg_policies.cmd` is full-name strings (`'INSERT'`, `'UPDATE'`, `'DELETE'`, `'SELECT'`, `'ALL'`)** in modern Postgres / Supabase, despite older docs implying single-character codes (`r`/`a`/`w`/`d`/`*`). Match against full names in audit queries.

### What's deferred

- **`strictons-prod` Supabase project provisioning.** Workflow file (`db-deploy-prod.yml`) is in place but inert. Provisioning runbook is in `packages/db/README.md` — create the project, set `SUPABASE_DB_URL_PROD` (session pooler URL) as a repo secret, configure the `production-database` GitHub Environment with required reviewers, dispatch a dry run, then dispatch real apply. Run when Phase 7 or 8 needs it.
- **Custom hotel domains UI.** Architecture is ready (`hotels.custom_domain` field nullable from day one, hostname-or-subpath middleware planned for `mystay`), but self-service UI is deferred per brief §3.1. Manual attachment via the admin runbook covers the first wave of requests.
- **Phase 9 analytics rollups.** Three rollup tables exist as empty skeletons keyed `(hotel_id, guide_id, business_id, event_type, time_bucket)` with `UNIQUE NULLS NOT DISTINCT`. The `pg_cron` jobs that populate them land in Phase 9 alongside the capture endpoints.
- **Cross-cluster `authenticated`-role write audit.** The blanket `anon` revoke is comprehensive; the `authenticated` revoke is per-table. If a future table grants `authenticated` writes broader than its policy allows, suite 01 test 21 catches it via the structural audit. No proactive sweep deferred — the audit is the standing safeguard.
