/**
 * Sentry Node.js (server) SDK initialization.
 *
 * Loaded by `instrumentation.ts` via the Next 15 `register()` hook
 * when the runtime is 'nodejs'. SDK + DSN only this phase per Q5.
 *
 * Reads `NEXT_PUBLIC_SENTRY_DSN` for consistency with the browser
 * init — one env var name across all runtimes. The DSN is public
 * by design.
 *
 * initialScope: { tags: { app: 'partners' } } tags every event with
 * the originating app, so the shared Sentry project can filter cleanly
 * between partners and admin without running separate projects.
 *
 * Server-side capture from Server Actions requires the
 * withServerActionInstrumentation() wrapper at each action site —
 * see Phase 4 commit 2 for the diagnostic that established this.
 * Without the wrapper, Vercel's serverless function freeze drops
 * unflushed events, AND Next.js production-mode error sanitisation
 * replaces the original error message with a generic placeholder
 * before onRequestError sees it.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    integrations: [],
    initialScope: { tags: { app: 'partners' } },
  });
}
