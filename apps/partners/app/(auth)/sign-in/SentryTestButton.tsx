'use client';

/**
 * TEMPORARY: remove after Sentry verification (Phase 3 commit 13).
 *
 * Throws a client-side Error so the browser-runtime @sentry/nextjs init
 * (instrumentation-client.ts) can be verified against the Issues tab in
 * the Sentry dashboard. Steven clicks once on the preview deploy, then
 * confirms an event arrives within ~30s; the trigger is then removed in
 * a follow-up commit.
 */
export function SentryTestButton(): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => {
        throw new Error('Sentry test from partners /sign-in (browser)');
      }}
      className="mt-6 rounded border border-amber-300 px-3 py-1 text-xs text-amber-800 hover:bg-amber-50"
    >
      Throw test error (Sentry verification)
    </button>
  );
}
