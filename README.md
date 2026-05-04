# Strictons

Monorepo for the Strictons guest-experience product. See [`STRICTONS-BRIEF.md`](./STRICTONS-BRIEF.md) for the product brief and [`CLAUDE.md`](./CLAUDE.md) for the working agreement.

## Stack

- Next.js 15 (App Router) on each of four apps
- TypeScript strict mode, no `any`
- Tailwind CSS v4 (CSS-first config) with shared design tokens
- pnpm 10 workspaces, Turborepo task pipeline
- Node 22 LTS

## Layout

```
apps/
  marketing/   # strictons.com public marketing site (port 3000)
  admin/       # strictons.com internal admin portal  (port 3001)
  partners/    # strictons.com hotel + business portal (port 3002)
  mystay/      # mystay.au guest-facing digital guide  (port 3003)

packages/
  config/
    eslint/    # @strictons/config-eslint    — flat-config base + next presets
    tsconfig/  # @strictons/config-tsconfig  — base / nextjs / react-library
    tailwind/  # @strictons/config-tailwind  — Tailwind v4 design tokens
  ui/          # @strictons/ui               — shared UI components
  types/       # @strictons/types            — shared TS types
```

`packages/db`, `packages/email`, `packages/cloudinary`, and `packages/analytics` land from Phase 2 onwards as the brief calls for them.

## Local development

Prerequisites: Node 22 (`nvm use`) and pnpm 10 (already pinned via `packageManager` in the root `package.json`).

```bash
pnpm install
pnpm dev                                    # all four apps in parallel
pnpm --filter @strictons/marketing dev      # one app
pnpm typecheck                              # all packages
pnpm lint                                   # all packages
pnpm build                                  # all apps
pnpm format                                 # write Prettier
```

The four apps run on ports 3000–3003 to avoid conflict during `pnpm dev`.

## Environment variables

- Each app has a `.env.example` documenting its env contract. Copy it to `.env.local` and fill in real values for local dev. `.env.local` is gitignored.
- Real values for preview and production live in **Vercel project settings**, not in this repo.
- Values that apply to multiple apps (e.g. shared Supabase URL once Phase 2 lands) should be defined once in Vercel as **shared environment variables** linked to all four projects rather than copied per-project.

## Deploying to Vercel

The repo deploys as four independent Vercel projects, all built from this single repository. This is the topology required to attach hotel custom domains only to the `mystay` project (per brief §3.1) without affecting the others.

For each of the four apps (`marketing`, `admin`, `partners`, `mystay`), in the Vercel dashboard:

1. **Create a new Vercel project** from this GitHub repo. Repeat four times — one project per app, named e.g. `strictons-marketing`, `strictons-admin`, `strictons-partners`, `strictons-mystay`.
2. **Set the Root Directory** for each project to `apps/<app-name>` (e.g. `apps/marketing`). This is what scopes Vercel to that single app inside the monorepo.
3. **Configure the build command** to use Turborepo's filter syntax so workspace dependencies are built before the app:

   ```
   cd ../.. && pnpm turbo run build --filter=@strictons/<app-name>...
   ```

   The trailing `...` includes the app's transitive workspace dependencies (e.g. `@strictons/ui`, `@strictons/config-tailwind`). Install command: `cd ../.. && pnpm install --frozen-lockfile`. Output Directory: `.next`.

4. **Set environment variables** in Vercel:
   - **Shared values** (used by more than one app — e.g. `SUPABASE_URL` once Phase 2 lands) → define once at the Vercel team level as a **shared environment variable** and link it to all four projects. Avoid duplicating shared secrets per-project.
   - **App-specific values** → set per-project in that project's environment-variable settings.
   - **Secrets** (any value that mustn't appear in client bundles) → mark as Secret in Vercel and never prefix with `NEXT_PUBLIC_`.
   - The `.env.example` in each app documents what's expected. Keep it current.

Custom hotel domains are attached only to the `strictons-mystay` Vercel project once self-domain support is enabled (deferred per brief §3.1; default deployment uses `mystay.au` only).

## Phase status

- **Phase 1 — foundation.** Done. Empty Next.js shells across four apps, shared config presets, CI green for typecheck + lint + build + format.
- **Phase 2 onwards.** Tracked separately in conversation. Don't start a new phase without an explicit go-ahead.
