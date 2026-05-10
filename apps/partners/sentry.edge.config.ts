/**
 * Sentry edge-runtime SDK initialization.
 *
 * Loaded by `instrumentation.ts` via the Next 15 `register()` hook
 * when the runtime is 'edge' (i.e. inside `middleware.ts` and any
 * edge-runtime Route Handlers). SDK + DSN only this phase per Q5.
 *
 * Reads `NEXT_PUBLIC_SENTRY_DSN` for consistency with the browser
 * and server init — one env var name across all runtimes. The DSN
 * is public by design.
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
