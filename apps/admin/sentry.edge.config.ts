/**
 * Sentry edge-runtime SDK initialization for the admin app.
 *
 * Loaded by `instrumentation.ts` via the Next 15 `register()` hook
 * when the runtime is 'edge' (i.e. inside `middleware.ts` and any
 * edge-runtime Route Handlers). SDK + DSN only this phase.
 *
 * Reads `NEXT_PUBLIC_SENTRY_DSN` for consistency with the browser
 * and server init — one env var name across all runtimes. The DSN
 * is public by design.
 *
 * initialScope: { tags: { app: 'admin' } } tags every event with
 * the originating app, so the shared Sentry project can filter
 * cleanly between partners and admin without separate projects.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    integrations: [],
    initialScope: { tags: { app: 'admin' } },
  });
}
