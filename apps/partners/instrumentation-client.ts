/**
 * Sentry browser-side SDK initialization.
 *
 * Per Q5, Phase 3 ships SDK + DSN only — no source-map upload, no
 * SENTRY_AUTH_TOKEN. Errors are reported with Sentry's release
 * fingerprinting (line numbers from minified bundles); proper
 * symbolication via uploaded source maps is a later phase.
 *
 * The DSN is read inside this file's top-level init() call rather than
 * captured in a module-level const because:
 *
 *   - if SENTRY_DSN is unset (local dev without a DSN configured), we
 *     want a silent no-op rather than a build- or import-time warning
 *   - Sentry's `init({ dsn: undefined })` is documented to be a no-op
 *
 * The C2 env-var-read-inside-function-body convention applies in spirit:
 * we only call init when DSN is actually set.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,

    // Light defaults for SDK + DSN only:
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Symbolicate via release fingerprinting only (no source-map upload).
    sendDefaultPii: false,

    // Don't auto-instrument every fetch — minimal noise this phase.
    integrations: [],
  });
}

// Required by Next 15 for navigation tracking. Sentry's setup wizard
// emits this even when init is no-op'd; the export must exist.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
