/**
 * Google Places (v1 API) adapter — admin-app-private.
 *
 * Phase 6 candidate-list curation, PHASE_6_PLAN.md §6. Single caller for
 * Phase 6 (the admin-app Google Places Route Handler + the
 * addCandidateFromGooglePlaces Server Action, both land in commit 6), so
 * this lives in apps/admin/lib/ rather than a shared package per the
 * Phase 5 admin-app-private-lift convention. Lift to @strictons/places
 * only when a second app needs it.
 *
 * Design (PHASE_6_PLAN.md §6):
 *   - Raw fetch, no @googlemaps/places SDK (§6.2).
 *   - Two endpoints: Text Search (POST) + Place Details (GET) (§6.3).
 *   - Tight X-Goog-FieldMask on both, excluding the priced Atmosphere
 *     tier (§6.3).
 *   - AU region + en-AU language on the search request.
 *   - 8s timeout per request via AbortController; AbortError →
 *     PlacesUpstreamError (§6.5).
 *   - HTTP non-2xx → PlacesUpstreamError carrying the status + Google's
 *     error-body message (§6.5).
 *   - Missing GOOGLE_PLACES_API_KEY → PlacesConfigError, distinct from
 *     PlacesUpstreamError so commit 6's Server Action can map the two to
 *     the audit reasons 'missing_api_key' vs 'places_api_failed' (§6.6).
 *   - Short-TTL in-memory LRU cache on globalThis (§6.4): 60s search,
 *     600s details, 500-entry cap. Per-Vercel-function-instance only.
 *   - Per-staff-user fixed-window rate limit on globalThis (§3.2): 30
 *     requests / 60s. Best-effort cost guard, not a security boundary;
 *     per-instance only. ("Token bucket" in the plan is implemented as a
 *     fixed-window counter — behaviourally ≤30 per 60s, which is the
 *     property that matters for a cost guard.)
 *
 * Env var: GOOGLE_PLACES_API_KEY, read inside the request functions
 * (never at module scope — the Phase 3 module-instance-split gotcha and
 * the §3.1 env-var convention). Server-side only, no NEXT_PUBLIC_ prefix.
 */

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_DETAILS_BASE = 'https://places.googleapis.com/v1/places/';

const SEARCH_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.primaryType,places.location';
const DETAILS_FIELD_MASK =
  'id,displayName,formattedAddress,primaryType,location,nationalPhoneNumber,websiteUri';

const REQUEST_TIMEOUT_MS = 8_000;
const SEARCH_MAX_RESULTS = 10;

const SEARCH_CACHE_TTL_MS = 60_000;
const DETAILS_CACHE_TTL_MS = 600_000;
const CACHE_MAX_ENTRIES = 500;

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

const CACHE_KEY = Symbol.for('@strictons/admin/places-cache');
const RATE_LIMIT_KEY = Symbol.for('@strictons/admin/places-rate-limit');

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export type PlaceResult = {
  placeId: string;
  name: string;
  formattedAddress?: string;
  primaryType?: string;
  location?: { lat: number; lng: number };
  /** Formatted national phone number. Populated by Place Details only. */
  phone?: string;
  /** Place website URL. Populated by Place Details only. */
  websiteUri?: string;
};

/**
 * Missing / empty GOOGLE_PLACES_API_KEY. Distinct from PlacesUpstreamError
 * so the caller can audit reason='missing_api_key' vs 'places_api_failed'.
 */
export class PlacesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlacesConfigError';
  }
}

/**
 * Any failure talking to Google: timeout, network error, or HTTP non-2xx.
 * `status` is set for HTTP non-2xx, undefined for timeout / network errors.
 */
export class PlacesUpstreamError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'PlacesUpstreamError';
    this.status = status;
  }
}

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

// ----------------------------------------------------------------------------
// globalThis-backed state (cache + rate-limit buckets)
// ----------------------------------------------------------------------------

type CacheEntry = { value: PlaceResult[] | PlaceResult; expiresAt: number };
type RateLimitEntry = { count: number; windowStartedAt: number };

function symbolStore(): Record<symbol, unknown> {
  return globalThis as unknown as Record<symbol, unknown>;
}

function getCache(): Map<string, CacheEntry> {
  const store = symbolStore();
  let cache = store[CACHE_KEY] as Map<string, CacheEntry> | undefined;
  if (!cache) {
    cache = new Map();
    store[CACHE_KEY] = cache;
  }
  return cache;
}

function getRateLimitBuckets(): Map<string, RateLimitEntry> {
  const store = symbolStore();
  let buckets = store[RATE_LIMIT_KEY] as Map<string, RateLimitEntry> | undefined;
  if (!buckets) {
    buckets = new Map();
    store[RATE_LIMIT_KEY] = buckets;
  }
  return buckets;
}

// ----------------------------------------------------------------------------
// LRU cache
// ----------------------------------------------------------------------------
// A JS Map preserves insertion order, so the first key is the
// least-recently-used. On read we delete+reinsert to move the entry to the
// MRU end; on write past the cap we evict from the front. Eviction is
// TTL-independent — an entry still within its TTL can be evicted under cap
// pressure (standard LRU); a stale entry is dropped lazily on read.

function cacheGet(key: string): PlaceResult[] | PlaceResult | undefined {
  const cache = getCache();
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // Move to MRU end.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cacheSet(key: string, value: PlaceResult[] | PlaceResult, ttlMs: number): void {
  const cache = getCache();
  // Delete first so a refreshed key re-inserts at the MRU end.
  cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// ----------------------------------------------------------------------------
// Rate limit (per-staff-user fixed window)
// ----------------------------------------------------------------------------

/**
 * Consume one rate-limit token for `userId`. Fixed 60s window, 30 requests.
 * Best-effort, per-Vercel-function-instance only — a cost guard, not a
 * security boundary (PHASE_6_PLAN.md §3.2). The Route Handler (commit 6)
 * calls this before hitting searchPlacesText.
 */
export function consumeRateLimit(userId: string): RateLimitResult {
  const buckets = getRateLimitBuckets();
  const now = Date.now();
  const entry = buckets.get(userId);

  if (!entry || now - entry.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    buckets.set(userId, { count: 1, windowStartedAt: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    const msLeft = entry.windowStartedAt + RATE_LIMIT_WINDOW_MS - now;
    return { allowed: false, retryAfterSeconds: Math.max(Math.ceil(msLeft / 1000), 1) };
  }

  entry.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

// ----------------------------------------------------------------------------
// HTTP helpers
// ----------------------------------------------------------------------------

function requireApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    throw new PlacesConfigError(
      'GOOGLE_PLACES_API_KEY is not set. The Google Places adapter cannot make requests.',
    );
  }
  return key;
}

/** fetch wrapped with an 8s AbortController timeout. */
async function placesFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new PlacesUpstreamError(
        `Google Places request timed out after ${REQUEST_TIMEOUT_MS}ms.`,
      );
    }
    throw new PlacesUpstreamError(
      `Google Places request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** Parse a JSON body, or throw PlacesUpstreamError on a non-2xx response. */
async function readJsonOrThrow(res: Response): Promise<unknown> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`.trim();
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      // Body wasn't JSON; keep the status-line message.
    }
    throw new PlacesUpstreamError(`Google Places API error: ${message}`, res.status);
  }
  return res.json();
}

// ----------------------------------------------------------------------------
// Google response mapping
// ----------------------------------------------------------------------------

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  primaryType?: string;
  location?: { latitude?: number; longitude?: number };
  nationalPhoneNumber?: string;
  websiteUri?: string;
};

function mapGooglePlace(place: GooglePlace): PlaceResult {
  const result: PlaceResult = {
    placeId: place.id ?? '',
    name: place.displayName?.text ?? '',
  };
  if (place.formattedAddress) result.formattedAddress = place.formattedAddress;
  if (place.primaryType) result.primaryType = place.primaryType;
  if (
    place.location &&
    typeof place.location.latitude === 'number' &&
    typeof place.location.longitude === 'number'
  ) {
    result.location = { lat: place.location.latitude, lng: place.location.longitude };
  }
  if (place.nationalPhoneNumber) result.phone = place.nationalPhoneNumber;
  if (place.websiteUri) result.websiteUri = place.websiteUri;
  return result;
}

// ----------------------------------------------------------------------------
// Public adapter functions
// ----------------------------------------------------------------------------

/**
 * Text Search. Cache key is the trim+lowercased query (case-insensitive
 * cache hits); the request body preserves the caller's casing. Empty
 * results are cached too — a known-empty query shouldn't re-hit Google
 * for the 60s TTL.
 */
export async function searchPlacesText(query: string): Promise<PlaceResult[]> {
  const cacheKey = `search:${query.trim().toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached as PlaceResult[];

  const apiKey = requireApiKey();
  const res = await placesFetch(PLACES_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query.trim(),
      maxResultCount: SEARCH_MAX_RESULTS,
      languageCode: 'en-AU',
      regionCode: 'AU',
    }),
  });

  const json = (await readJsonOrThrow(res)) as { places?: GooglePlace[] };
  const results = (json.places ?? []).slice(0, SEARCH_MAX_RESULTS).map(mapGooglePlace);
  cacheSet(cacheKey, results, SEARCH_CACHE_TTL_MS);
  return results;
}

/**
 * Place Details. Cache key is the verbatim placeId (opaque, case-sensitive
 * Google identifier). 600s TTL — place metadata is stable.
 */
export async function getPlaceDetails(placeId: string): Promise<PlaceResult> {
  const cacheKey = `details:${placeId}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached as PlaceResult;

  const apiKey = requireApiKey();
  const res = await placesFetch(`${PLACES_DETAILS_BASE}${encodeURIComponent(placeId)}`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': DETAILS_FIELD_MASK,
    },
  });

  const json = (await readJsonOrThrow(res)) as GooglePlace;
  const result = mapGooglePlace(json);
  cacheSet(cacheKey, result, DETAILS_CACHE_TTL_MS);
  return result;
}
