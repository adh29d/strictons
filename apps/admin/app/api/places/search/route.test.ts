import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { PlacesConfigError, PlacesUpstreamError } from '@/lib/google-places';

// ---- Mocks ---------------------------------------------------------------

const requireStaffMock = vi.fn();
const consumeRateLimitMock = vi.fn();
const searchPlacesTextMock = vi.fn();

// wrapRouteHandlerWithSentry is mocked as a pass-through — the SDK
// wrapper is Sentry's tested concern; this suite exercises the handler
// logic directly.
vi.mock('@sentry/nextjs', () => ({
  wrapRouteHandlerWithSentry: (handler: unknown) => handler,
}));
vi.mock('@/lib/require-staff', () => ({
  requireStaff: () => requireStaffMock(),
}));
// consumeRateLimit + searchPlacesText are mocked; the PlacesConfigError /
// PlacesUpstreamError classes are kept REAL via importActual so the
// route's `instanceof` checks hold.
vi.mock('@/lib/google-places', async () => {
  const actual = await vi.importActual<typeof import('@/lib/google-places')>('@/lib/google-places');
  return {
    ...actual,
    consumeRateLimit: (...args: unknown[]) => consumeRateLimitMock(...args),
    searchPlacesText: (...args: unknown[]) => searchPlacesTextMock(...args),
  };
});

// ---- Constants + helpers -------------------------------------------------

const STAFF_USER_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_EMAIL = 'staff@strictons.test';
const HOTEL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const SEARCH_RESULT = {
  placeId: 'ChIJ_1',
  name: 'Beachside Cafe',
  formattedAddress: '1 Beach Rd, Sydney NSW',
  primaryType: 'cafe',
  location: { lat: -33.8, lng: 151.2 },
};

/** A POST NextRequest. `body` is sent verbatim — pass a non-JSON string
 *  to exercise the unparseable-body branch. */
function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/places/search', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  requireStaffMock.mockReset();
  consumeRateLimitMock.mockReset();
  searchPlacesTextMock.mockReset();
  requireStaffMock.mockResolvedValue({
    kind: 'ok',
    userId: STAFF_USER_ID,
    email: STAFF_EMAIL,
  });
  consumeRateLimitMock.mockReturnValue({ allowed: true, remaining: 29 });
  searchPlacesTextMock.mockResolvedValue([SEARCH_RESULT]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/places/search', () => {
  it('401 when the caller is not staff — rate limit NOT consumed, search NOT called', async () => {
    requireStaffMock.mockResolvedValue({ kind: 'error', error: 'Not signed in.' });

    const res = await POST(makeRequest({ query: 'coffee', hotelId: HOTEL_ID }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'Not signed in.' });
    expect(consumeRateLimitMock).not.toHaveBeenCalled();
    expect(searchPlacesTextMock).not.toHaveBeenCalled();
  });

  it('400 when the request body is not valid JSON', async () => {
    const res = await POST(makeRequest('not-json{'));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'Request body must be valid JSON.' });
    expect(consumeRateLimitMock).not.toHaveBeenCalled();
    expect(searchPlacesTextMock).not.toHaveBeenCalled();
  });

  it('400 when the body fails GooglePlacesSearchInputSchema validation', async () => {
    // query too short (min 2) — and rate limit must not be consumed.
    const res = await POST(makeRequest({ query: 'a', hotelId: HOTEL_ID }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'Invalid search request.' });
    expect(consumeRateLimitMock).not.toHaveBeenCalled();
    expect(searchPlacesTextMock).not.toHaveBeenCalled();
  });

  it('429 with a Retry-After header when the rate limit is exceeded — search NOT called', async () => {
    consumeRateLimitMock.mockReturnValue({ allowed: false, retryAfterSeconds: 42 });

    const res = await POST(makeRequest({ query: 'coffee', hotelId: HOTEL_ID }));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect((await res.json()).ok).toBe(false);
    expect(consumeRateLimitMock).toHaveBeenCalledWith(STAFF_USER_ID);
    expect(searchPlacesTextMock).not.toHaveBeenCalled();
  });

  it('200 with the adapter results on a successful search', async () => {
    const res = await POST(makeRequest({ query: 'coffee near the pier', hotelId: HOTEL_ID }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, results: [SEARCH_RESULT] });
    expect(searchPlacesTextMock).toHaveBeenCalledWith('coffee near the pier');
  });

  it('200 caps the response at 10 results even if the adapter returns more', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({
      ...SEARCH_RESULT,
      placeId: `ChIJ_${i}`,
    }));
    searchPlacesTextMock.mockResolvedValue(twelve);

    const res = await POST(makeRequest({ query: 'many cafes', hotelId: HOTEL_ID }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; results: unknown[] };
    expect(body.results).toHaveLength(10);
  });

  it('502 when the adapter throws PlacesUpstreamError', async () => {
    searchPlacesTextMock.mockRejectedValue(
      new PlacesUpstreamError('Google Places API error: 503', 503),
    );

    const res = await POST(makeRequest({ query: 'coffee', hotelId: HOTEL_ID }));

    expect(res.status).toBe(502);
    expect((await res.json()).ok).toBe(false);
  });

  it('500 when the adapter throws PlacesConfigError (missing GOOGLE_PLACES_API_KEY)', async () => {
    searchPlacesTextMock.mockRejectedValue(
      new PlacesConfigError('GOOGLE_PLACES_API_KEY is not set.'),
    );

    const res = await POST(makeRequest({ query: 'coffee', hotelId: HOTEL_ID }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'Search is temporarily unavailable.',
    });
  });
});
