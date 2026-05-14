import { NextResponse, type NextRequest } from 'next/server';
import { wrapRouteHandlerWithSentry } from '@sentry/nextjs';
import { GooglePlacesSearchInputSchema } from '@strictons/types/candidates';
import { requireStaff } from '@/lib/require-staff';
import {
  consumeRateLimit,
  searchPlacesText,
  PlacesConfigError,
  PlacesUpstreamError,
} from '@/lib/google-places';

/**
 * POST /api/places/search — Google Places Text Search proxy (admin-only).
 *
 * PHASE_6_PLAN.md §3.2. The admin-app Google Places search panel
 * (commit 8) POSTs here; the Server Action addCandidateFromGooglePlaces
 * (commit 6, ./actions.ts) does NOT go through this route — it fetches
 * Place Details directly via the adapter.
 *
 * Flow (order matters):
 *   1. Auth gate — requireStaff(). Not staff → 401. requireStaff() uses
 *      the cookie-based server client internally, so it works in a
 *      Route Handler exactly as in a Server Action.
 *   2. Parse + validate the JSON body with GooglePlacesSearchInputSchema.
 *      Unparseable body or zod failure → 400.
 *   3. Rate limit — consumeRateLimit(userId) BEFORE the upstream call.
 *      Overflow → 429 with a Retry-After header. The bucket is the
 *      commit-3 adapter's globalThis-keyed per-staff-user counter; it
 *      is consumed here and ONLY here (the add-by-placeId Server Action
 *      does not share it — §3.2).
 *   4. Upstream — searchPlacesText() via the commit-3 adapter, the
 *      single source of truth for fetch / cache / typed errors. The
 *      adapter caps at 10 results; the route re-slices defensively so
 *      the §3.2 response contract holds at the API boundary.
 *
 * Error → status mapping:
 *   - PlacesConfigError (missing GOOGLE_PLACES_API_KEY) → 500. A missing
 *     key is server-side misconfiguration, not a client error and not
 *     an upstream Google failure.
 *   - PlacesUpstreamError (HTTP non-2xx / timeout / network) → 502.
 *   - Anything else → rethrown so wrapRouteHandlerWithSentry captures it.
 *
 * Not audited: per §3.2, searches are not written to audit_log (only
 * the add Server Action audits). This handler imports no audit helper.
 *
 * Wrapped in wrapRouteHandlerWithSentry — the SDK-native Route Handler
 * equivalent of withServerActionInstrumentation (auto-flush via
 * vercelWaitUntil + original-error-preserving captureException), same
 * locked pattern as the /auth/confirm handler.
 */

const SEARCH_RESULT_CAP = 10;

export const POST = wrapRouteHandlerWithSentry(
  async (request: NextRequest): Promise<NextResponse> => {
    // ---- 1. Auth gate ----
    const auth = await requireStaff();
    if (auth.kind === 'error') {
      return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
    }

    // ---- 2. Parse + validate body ----
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Request body must be valid JSON.' },
        { status: 400 },
      );
    }
    const parsed = GooglePlacesSearchInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'Invalid search request.' }, { status: 400 });
    }

    // ---- 3. Rate limit (before the upstream call) ----
    const rateLimit = consumeRateLimit(auth.userId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { ok: false, error: 'Too many searches. Please wait a moment and try again.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    // ---- 4. Upstream search via the adapter ----
    try {
      const results = await searchPlacesText(parsed.data.query);
      return NextResponse.json({ ok: true, results: results.slice(0, SEARCH_RESULT_CAP) });
    } catch (cause) {
      if (cause instanceof PlacesConfigError) {
        return NextResponse.json(
          { ok: false, error: 'Search is temporarily unavailable.' },
          { status: 500 },
        );
      }
      if (cause instanceof PlacesUpstreamError) {
        return NextResponse.json(
          { ok: false, error: 'Could not reach the places service. Please try again.' },
          { status: 502 },
        );
      }
      // Genuinely unexpected — rethrow so Sentry captures it with the
      // original error preserved.
      throw cause;
    }
  },
  { method: 'POST', parameterizedRoute: '/api/places/search' },
);
