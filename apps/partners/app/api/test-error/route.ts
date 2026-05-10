/**
 * TEMPORARY: remove after Sentry verification (Phase 3 commit 13).
 *
 * GET /api/test-error throws server-side so the Node-runtime
 * @sentry/nextjs init (sentry.server.config.ts dispatched via
 * instrumentation.ts) can be verified against the Issues tab in the
 * Sentry dashboard. Steven hits the URL once on the preview deploy,
 * then confirms an event arrives within ~30s; the trigger is then
 * removed in a follow-up commit.
 *
 * The route is mounted under app/api/test-error so middleware's
 * matcher (which excludes api/_test, not api/*) does NOT skip it —
 * we want middleware to run as part of the verification path. If
 * the auth gate redirects an unauthenticated caller to /sign-in,
 * Steven signs in first, then hits this URL.
 */
export async function GET(): Promise<Response> {
  throw new Error('Sentry test from partners /api/test-error (server)');
}
