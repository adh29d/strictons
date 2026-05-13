/**
 * Sentry browser-side SDK initialization.
 *
 * Per Q5, Phase 3 ships SDK + DSN only — no source-map upload, no
 * SENTRY_AUTH_TOKEN. Errors are reported with Sentry's release
 * fingerprinting (line numbers from minified bundles); proper
 * symbolication via uploaded source maps is a later phase.
 *
 * The DSN is read from `NEXT_PUBLIC_SENTRY_DSN` — Sentry DSNs are
 * public credentials by design (embedded in client bundles wherever
 * Sentry is used in any web app), so the NEXT_PUBLIC_ prefix is the
 * correct shape. Server and edge init files read the same variable
 * for consistency.
 *
 * initialScope: { tags: { app: 'partners' } } tags every event with
 * the originating app, so the shared Sentry project can filter cleanly
 * between partners and admin without running separate projects.
 *
 * Init only runs when DSN is set; otherwise silent no-op so local dev
 * without a Sentry project configured doesn't error out.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

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

    initialScope: { tags: { app: 'partners' } },
  });
}

// Required by Next 15 for navigation tracking. Sentry's setup wizard
// emits this even when init is no-op'd; the export must exist.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
