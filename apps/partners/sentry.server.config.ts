/**
 * Sentry Node.js (server) SDK initialization.
 *
 * Loaded by `instrumentation.ts` via the Next 15 `register()` hook
 * when the runtime is 'nodejs'. SDK + DSN only this phase per Q5.
 *
 * Reads `NEXT_PUBLIC_SENTRY_DSN` for consistency with the browser
 * init — one env var name across all runtimes. The DSN is public
 * by design.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    integrations: [],
  });
}
