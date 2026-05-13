/**
 * Next.js 15 instrumentation hook. Called once per runtime at server
 * boot; dispatches to the per-runtime Sentry init file.
 *
 *   nodejs runtime  → sentry.server.config.ts (Server Components,
 *                                                Route Handlers,
 *                                                Server Actions)
 *   edge   runtime  → sentry.edge.config.ts   (middleware, edge RH)
 *
 * Browser-side init lives in instrumentation-client.ts and is loaded
 * by Next automatically.
 */
import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Required by Next 15 for capturing nested React errors. Without this
 * export, errors thrown deep in Server Components don't surface to
 * Sentry. Set up by Sentry's docs as part of the instrumentation hook.
 */
export const onRequestError = Sentry.captureRequestError;
