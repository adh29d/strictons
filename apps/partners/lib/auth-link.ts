/**
 * Environment-variable convention.
 *
 * Env vars are read inside the factory function body, never at module
 * top-level. Top-level reads run during Next.js build-time static analysis;
 * when a var is unset (CI, preview environments before configuration,
 * vendored builds) a top-level `process.env.X` evaluation can throw at
 * import time or freeze the resulting value into the build artefact.
 * Reading inside the function defers evaluation to first call, where a
 * missing var fails loudly with an actionable error and the dead-code
 * elimination boundary is unaffected.
 */

/**
 * Resolve the partners app's externally-reachable URL.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_PARTNERS_URL   — set explicitly in production and
 *                                    locally (with protocol).
 *   2. VERCEL_URL                  — set automatically on Vercel preview
 *                                    deploys (no protocol; we prepend
 *                                    https://).
 *
 * Throws if neither is available — there is no safe default for the
 * magic-link redirect target.
 */
export function resolvePartnersUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_PARTNERS_URL;
  if (explicit) return stripTrailingSlash(explicit);

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${stripTrailingSlash(vercel)}`;

  throw new Error(
    'resolvePartnersUrl: neither NEXT_PUBLIC_PARTNERS_URL nor VERCEL_URL is set; cannot construct the magic-link redirect target',
  );
}

export type BuildConfirmUrlInput = {
  partnersUrl: string;
  tokenHash: string;
  /**
   * Verification type. The C1 verification round (commit 8 first push)
   * confirms which value GoTrue accepts when paired with token_hash.
   * Plan currently codes against 'email'.
   */
  type: string;
  /** Relative path the route handler redirects to after sign-in. */
  next: string;
};

/**
 * Build the partners-side /auth/confirm URL the magic-link email
 * carries. The Route Handler at that path consumes (token_hash, type,
 * next) and exchanges the token for a session via verifyOtp.
 */
export function buildConfirmUrl(input: BuildConfirmUrlInput): string {
  const url = new URL('/auth/confirm', input.partnersUrl);
  url.searchParams.set('token_hash', input.tokenHash);
  url.searchParams.set('type', input.type);
  url.searchParams.set('next', input.next);
  return url.toString();
}

/**
 * Validate that a `next` value from a URL parameter is a relative
 * in-app path. Mirrors the SignInInputSchema refine in
 * @strictons/types/auth — Route Handlers consume the value via URL
 * params and don't run the full Zod schema.
 */
export function isSafeNextPath(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith('/') && !value.startsWith('//');
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/$/, '');
}

// ---- C1 verification: response shape masking ------------------------------

/**
 * Mask sensitive fields in an admin.generateLink response so the shape
 * can be logged for the C1 empirical-verification step on first push
 * without leaking actual token material. The structure (keys, types,
 * nesting) is preserved so reviewers can see what the Supabase API
 * actually returned vs what the plan assumed.
 *
 * Removed at commit 9 (or earlier follow-up) once the verification has
 * been done and the shape is locked in.
 */
export function maskGenerateLinkResponseForVerification(data: unknown): unknown {
  if (data === null || typeof data !== 'object') return data;
  const obj = data as Record<string, unknown>;
  const properties =
    obj.properties && typeof obj.properties === 'object'
      ? (obj.properties as Record<string, unknown>)
      : null;

  return {
    ...obj,
    properties: properties
      ? {
          ...properties,
          hashed_token:
            typeof properties.hashed_token === 'string'
              ? `<${properties.hashed_token.length} chars masked>`
              : properties.hashed_token,
          email_otp: typeof properties.email_otp === 'string' ? '<masked>' : properties.email_otp,
          action_link:
            typeof properties.action_link === 'string'
              ? maskTokensInUrl(properties.action_link)
              : properties.action_link,
        }
      : properties,
    user:
      obj.user && typeof obj.user === 'object'
        ? {
            id: (obj.user as Record<string, unknown>).id,
            email: (obj.user as Record<string, unknown>).email,
            role: (obj.user as Record<string, unknown>).role,
          }
        : obj.user,
  };
}

function maskTokensInUrl(url: string): string {
  return url.replace(/([?&](?:token_hash|token|access_token|refresh_token)=)[^&]+/g, '$1<masked>');
}
