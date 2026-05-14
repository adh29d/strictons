import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeRateLimit,
  getPlaceDetails,
  PlacesConfigError,
  PlacesUpstreamError,
  searchPlacesText,
} from './google-places';

// Field masks the adapter MUST send. Hardcoded here (not imported) so a
// change to the adapter's constants is caught as a test failure.
const EXPECTED_SEARCH_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.primaryType,places.location';
const EXPECTED_DETAILS_FIELD_MASK =
  'id,displayName,formattedAddress,primaryType,location,nationalPhoneNumber,websiteUri';

const CACHE_SYMBOL = Symbol.for('@strictons/admin/places-cache');
const RATE_LIMIT_SYMBOL = Symbol.for('@strictons/admin/places-rate-limit');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// A Response body can only be read once, so every fetch call must get a
// FRESH Response. mockImplementation (not mockResolvedValue) mints a new
// one per call — required for any test that triggers more than one fetch.
function mockFetchJson(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(jsonResponse(body, status)));
}

const SEARCH_BODY = {
  places: [
    {
      id: 'ChIJ_search_1',
      displayName: { text: 'Beachside Cafe', languageCode: 'en' },
      formattedAddress: '1 Beach Rd, Sydney NSW',
      primaryType: 'cafe',
      location: { latitude: -33.8, longitude: 151.2 },
    },
  ],
};

const DETAILS_BODY = {
  id: 'ChIJ_details_1',
  displayName: { text: 'Beachside Cafe' },
  formattedAddress: '1 Beach Rd, Sydney NSW',
  primaryType: 'cafe',
  location: { latitude: -33.8, longitude: 151.2 },
  nationalPhoneNumber: '(02) 1234 5678',
  websiteUri: 'https://beachside.example',
};

beforeEach(() => {
  // Reset the globalThis-backed cache + rate-limit buckets between tests.
  const store = globalThis as unknown as Record<symbol, unknown>;
  delete store[CACHE_SYMBOL];
  delete store[RATE_LIMIT_SYMBOL];
  vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-places-key');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('searchPlacesText — happy path', () => {
  it('maps Google places into PlaceResult[]', async () => {
    mockFetchJson(SEARCH_BODY);

    const results = await searchPlacesText('coffee near pier');

    expect(results).toEqual([
      {
        placeId: 'ChIJ_search_1',
        name: 'Beachside Cafe',
        formattedAddress: '1 Beach Rd, Sydney NSW',
        primaryType: 'cafe',
        location: { lat: -33.8, lng: 151.2 },
      },
    ]);
  });

  it('returns [] for an empty result set without throwing', async () => {
    mockFetchJson({});
    expect(await searchPlacesText('nothing here')).toEqual([]);
  });

  it('POSTs the AU region/language body and the search field mask', async () => {
    const fetchSpy = mockFetchJson(SEARCH_BODY);

    await searchPlacesText('coffee');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    const requestInit = init as RequestInit;
    expect(requestInit.method).toBe('POST');
    const headers = requestInit.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('test-places-key');
    expect(headers['X-Goog-FieldMask']).toBe(EXPECTED_SEARCH_FIELD_MASK);
    expect(JSON.parse(requestInit.body as string)).toEqual({
      textQuery: 'coffee',
      maxResultCount: 10,
      languageCode: 'en-AU',
      regionCode: 'AU',
    });
  });

  it('caps results at 10 even if Google returns more', async () => {
    const places = Array.from({ length: 15 }, (_, i) => ({
      id: `ChIJ_${i}`,
      displayName: { text: `Place ${i}` },
    }));
    mockFetchJson({ places });

    const results = await searchPlacesText('many results');
    expect(results).toHaveLength(10);
  });
});

describe('getPlaceDetails — happy path', () => {
  it('maps a Place Details response including phone + websiteUri', async () => {
    mockFetchJson(DETAILS_BODY);

    const result = await getPlaceDetails('ChIJ_details_1');

    expect(result).toEqual({
      placeId: 'ChIJ_details_1',
      name: 'Beachside Cafe',
      formattedAddress: '1 Beach Rd, Sydney NSW',
      primaryType: 'cafe',
      location: { lat: -33.8, lng: 151.2 },
      phone: '(02) 1234 5678',
      websiteUri: 'https://beachside.example',
    });
  });

  it('GETs the place URL with the details field mask', async () => {
    const fetchSpy = mockFetchJson(DETAILS_BODY);

    await getPlaceDetails('ChIJ_details_1');

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://places.googleapis.com/v1/places/ChIJ_details_1');
    const requestInit = init as RequestInit;
    expect(requestInit.method).toBe('GET');
    const headers = requestInit.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('test-places-key');
    expect(headers['X-Goog-FieldMask']).toBe(EXPECTED_DETAILS_FIELD_MASK);
  });

  it('omits optional fields Google did not return', async () => {
    mockFetchJson({ id: 'ChIJ_bare', displayName: { text: 'Bare Place' } });

    const result = await getPlaceDetails('ChIJ_bare');
    expect(result).toEqual({ placeId: 'ChIJ_bare', name: 'Bare Place' });
    expect(result.phone).toBeUndefined();
    expect(result.location).toBeUndefined();
  });
});

describe('error handling', () => {
  it('throws PlacesUpstreamError with the status + Google message on a 4xx', async () => {
    mockFetchJson({ error: { message: 'API key not valid' } }, 400);

    // Single call — capture the error once, assert every property on it.
    // (A Response body reads once; a second call would re-read a spent body.)
    const err = await searchPlacesText('coffee').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlacesUpstreamError);
    expect((err as PlacesUpstreamError).status).toBe(400);
    expect((err as PlacesUpstreamError).message).toMatch(/API key not valid/);
  });

  it('throws PlacesUpstreamError with the status on a 5xx', async () => {
    mockFetchJson({ error: { message: 'Internal error' } }, 503);

    const err = await searchPlacesText('coffee').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlacesUpstreamError);
    expect((err as PlacesUpstreamError).status).toBe(503);
  });

  it('falls back to the status line when the error body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
      ),
    );

    await expect(getPlaceDetails('ChIJ_x')).rejects.toMatchObject({
      name: 'PlacesUpstreamError',
      status: 502,
    });
  });

  it('throws PlacesUpstreamError (timeout) when the request exceeds 8s', async () => {
    vi.useFakeTimers();
    // Mock fetch to hang until its abort signal fires.
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const promise = searchPlacesText('slow query');
    // Attach a catch synchronously so the rejection isn't flagged unhandled
    // while the fake clock advances.
    const settled = promise.then(
      () => ({ ok: true as const }),
      (e: unknown) => ({ ok: false as const, error: e }),
    );

    await vi.advanceTimersByTimeAsync(8_000);

    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(PlacesUpstreamError);
      expect((outcome.error as PlacesUpstreamError).message).toMatch(/timed out/);
    }
  });

  it('throws PlacesConfigError when GOOGLE_PLACES_API_KEY is unset', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const err = await searchPlacesText('coffee').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlacesConfigError);
    expect(err).not.toBeInstanceOf(PlacesUpstreamError);
    // The adapter must fail before making any network call.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('caching', () => {
  it('serves a repeated search from cache without re-fetching (cache hit)', async () => {
    const fetchSpy = mockFetchJson(SEARCH_BODY);

    await searchPlacesText('coffee');
    await searchPlacesText('coffee');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('treats case/whitespace-different queries as the same cache key', async () => {
    const fetchSpy = mockFetchJson(SEARCH_BODY);

    await searchPlacesText('Coffee');
    await searchPlacesText('  coffee  ');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('re-fetches for a genuinely different query (cache miss)', async () => {
    const fetchSpy = mockFetchJson(SEARCH_BODY);

    await searchPlacesText('coffee');
    await searchPlacesText('tea');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('caches an empty result set (no re-fetch within the TTL)', async () => {
    const fetchSpy = mockFetchJson({});

    await searchPlacesText('nothing');
    await searchPlacesText('nothing');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('caches search and details independently with their own TTLs', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = String(url);
      return Promise.resolve(
        u.includes(':searchText') ? jsonResponse(SEARCH_BODY) : jsonResponse(DETAILS_BODY),
      );
    });

    await searchPlacesText('coffee');
    await getPlaceDetails('ChIJ_details_1');
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // 90s in: search TTL (60s) has expired, details TTL (600s) has not.
    await vi.advanceTimersByTimeAsync(90_000);
    await searchPlacesText('coffee');
    await getPlaceDetails('ChIJ_details_1');

    // One extra fetch for the search re-fetch; details still cached.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('re-fetches a search after its 60s TTL expires', async () => {
    vi.useFakeTimers();
    const fetchSpy = mockFetchJson(SEARCH_BODY);

    await searchPlacesText('coffee');
    await vi.advanceTimersByTimeAsync(60_001);
    await searchPlacesText('coffee');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('evicts the least-recently-used entry once the 500-entry cap is exceeded', async () => {
    const fetchSpy = mockFetchJson(SEARCH_BODY);

    // Fill the cache to exactly the 500-entry cap.
    for (let i = 0; i < 500; i += 1) {
      await searchPlacesText(`query-${i}`);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(500);

    // The 501st distinct query evicts query-0 (the LRU entry).
    await searchPlacesText('query-500');
    expect(fetchSpy).toHaveBeenCalledTimes(501);

    // query-0 is gone → re-fetch. query-500 is still cached → no fetch.
    await searchPlacesText('query-0');
    expect(fetchSpy).toHaveBeenCalledTimes(502);
    await searchPlacesText('query-500');
    expect(fetchSpy).toHaveBeenCalledTimes(502);
  });

  it('keeps a recently-read entry from being evicted (LRU read promotes)', async () => {
    const fetchSpy = mockFetchJson(SEARCH_BODY);

    for (let i = 0; i < 500; i += 1) {
      await searchPlacesText(`q-${i}`);
    }
    // Read q-0 → promotes it to MRU; q-1 is now the LRU entry.
    await searchPlacesText('q-0');
    expect(fetchSpy).toHaveBeenCalledTimes(500);

    // A new entry evicts q-1, not the just-read q-0.
    await searchPlacesText('q-new');
    expect(fetchSpy).toHaveBeenCalledTimes(501);

    await searchPlacesText('q-0'); // still cached
    expect(fetchSpy).toHaveBeenCalledTimes(501);
    await searchPlacesText('q-1'); // evicted → re-fetch
    expect(fetchSpy).toHaveBeenCalledTimes(502);
  });
});

describe('consumeRateLimit', () => {
  it('allows the first 30 requests in a window and reports remaining', () => {
    for (let i = 0; i < 30; i += 1) {
      const result = consumeRateLimit('staff-user-1');
      expect(result.allowed).toBe(true);
      if (result.allowed) expect(result.remaining).toBe(29 - i);
    }
  });

  it('rejects the 31st request in the window with a retryAfterSeconds', () => {
    for (let i = 0; i < 30; i += 1) consumeRateLimit('staff-user-1');

    const overflow = consumeRateLimit('staff-user-1');
    expect(overflow.allowed).toBe(false);
    if (!overflow.allowed) {
      expect(overflow.retryAfterSeconds).toBeGreaterThan(0);
      expect(overflow.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it('tracks separate buckets per user', () => {
    for (let i = 0; i < 30; i += 1) consumeRateLimit('staff-user-1');
    expect(consumeRateLimit('staff-user-1').allowed).toBe(false);
    // A different user has a fresh bucket.
    expect(consumeRateLimit('staff-user-2').allowed).toBe(true);
  });

  it('resets the bucket once the 60s window has elapsed', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 30; i += 1) consumeRateLimit('staff-user-1');
    expect(consumeRateLimit('staff-user-1').allowed).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(consumeRateLimit('staff-user-1').allowed).toBe(true);
  });
});
