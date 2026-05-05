# Strictons project — working agreement

## Project overview

Read `STRICTONS_BRIEF.md` in this directory for the full product brief. Always reference it when making architectural or product decisions. If the brief and this file disagree, ask before resolving — don't assume one supersedes the other.

## Stack

- **Next.js** (App Router) deployed via Vercel
- **TypeScript** throughout, strict mode
- **Tailwind CSS** for styling
- **pnpm** as package manager, with pnpm workspaces for the monorepo
- **Supabase** for database, Row Level Security, and auth token generation (magic link, 7-day sessions)
- **SendGrid** for all transactional email, sent from `welcome@strictons.com` (already configured)
- **Cloudinary** for image storage, transformation, and delivery
- **Supabase Storage** for non-image files only (signed contracts, brand guideline PDFs)

## Architecture

One monorepo containing four Next.js apps:

- `apps/marketing` — strictons.com public marketing site
- `apps/admin` — Strictons internal admin portal
- `apps/partners` — combined hotel + business partner portal (one app, role-based)
- `apps/mystay` — guest-facing digital guide at mystay.au (with custom hotel domain support designed in from day one — see brief section 3.1)

Shared code in `packages/`:

- `packages/db` — Supabase client, generated types, migrations, RLS policies
- `packages/ui` — shared UI components
- `packages/types` — shared TypeScript types
- `packages/email` — SendGrid client, email templates, send wrappers
- `packages/cloudinary` — Cloudinary client, signed upload helpers, transformation URL builders
- `packages/analytics` — event capture helpers, rollup job definitions
- `packages/config` — shared config (eslint, tsconfig, tailwind preset)

## Working style

- **Plan before building.** Before starting any non-trivial task, explain your plan in plain language and wait for confirmation. "Non-trivial" means anything beyond a single-file edit or an obvious bug fix.
- **Small, focused commits.** Clear commit messages. One logical change per commit.
- **Stop after each phase.** When a phase is complete, summarise what changed and what's next. Do not auto-continue to the next phase.
- **Ask before installing dependencies.** Explain why each new package is needed and whether a lighter alternative exists.
- **Never push to remote, never deploy, never run destructive database operations** without explicit confirmation.
- **Run `pnpm typecheck` and `pnpm lint`** after meaningful changes. Fix issues before declaring a task done.
- **Read the brief.** When in doubt about a product decision, re-read the relevant section of `STRICTONS_BRIEF.md` before guessing or asking.

## Code conventions

- **Server Components by default.** Mark Client Components explicitly with `'use client'` and only when interactivity genuinely requires it.
- **All database access goes through `packages/db`.** Apps never import `@supabase/supabase-js` directly.
- **All email sending goes through `packages/email`.** Apps never call SendGrid directly.
- **All Cloudinary access goes through `packages/cloudinary`.** Apps construct URLs via the transformation builder, not by hand.
- **Row Level Security is the primary access control mechanism**, not application-level checks alone. Every table has explicit RLS policies.
- **Tracked event capture happens server-side wherever possible** (see brief section 7.5). Client-side capture is the exception, not the default.
- **No `any` types.** If a type is genuinely unknown, use `unknown` and narrow.
- **No barrel imports across package boundaries** that re-export everything — they break tree-shaking.

## Testing

- **Vitest** for unit tests (utility functions, transformation builders, email template rendering).
- **Playwright** for end-to-end tests (critical user flows: hotel sign-in via magic link, business brief submission, guest viewing a hotel guide).
- Tests are required for: anything in `packages/db` that touches RLS, anything in `packages/analytics`, the magic-link auth flow, the Cloudinary signed-upload flow.
- Tests are not required for: marketing pages, simple presentational components.

## Out of scope until later

These are explicitly deferred. Don't build them unless we agree to bring them forward:

- Custom hotel domain self-service UI (architecture supports it; UI deferred — see brief section 3.1)
- Self-supplied ad upload flow (brief section 9.8)
- Photo session upsell flow (brief section 9.9 fallback option 3)
- Stock photography library integration (brief section 9.9 fallback option 2)
- Visual sharpness check on uploads (brief section 9.9 — future enhancement)
- Marketing site content beyond a basic skeleton (focus is on the operational product first)

## When to ask vs when to decide

**Ask first** if:
- The decision changes the data model
- The decision affects more than one app or package
- The decision involves a new vendor or paid service
- The decision contradicts something in the brief
- You're unsure whether something is in or out of scope

**Decide and proceed** if:
- The decision is local to one file or one feature
- It's a stylistic or naming choice with no meaningful trade-off
- It's a standard convention for the stack

When you decide and proceed, mention what you decided in the summary at the end of the task.

## End of phase

At the end of each phase (PR merged to `main`, deploy verified, manual verification done), append a new section to `PROJECT_LOG.md` covering "What landed", "Locked decisions", "Gotchas", and "What's deferred". Use existing entries as the template. This is the last commit of the phase, on a small follow-up PR.
