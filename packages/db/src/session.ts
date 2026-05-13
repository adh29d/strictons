/**
 * 7-day "remember this device" session window for partner sign-in.
 *
 * Single source of truth — the cookie-bound clients in `server.ts` and
 * `browser.ts` reference this for `cookieOptions.maxAge`, and the
 * partners-app middleware reuses it for the response cookies it writes
 * during refresh.
 *
 * Default Supabase JWT expiry (1 hour) and refresh-token rotation are left
 * untouched; the cookie's max-age is what bounds how long a "remember this
 * device" session survives without re-authentication.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
