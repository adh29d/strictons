/**
 * Sentry Node.js (server) SDK initialization.
 *
 * Loaded by `instrumentation.ts` via the Next 15 `register()` hook
 * when the runtime is 'nodejs'. SDK + DSN only this phase per Q5.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    integrations: [],
  });
}
