import { z } from 'zod';

/**
 * Schema for the sign-in form payload.
 *
 * Consumed by `apps/partners/app/(auth)/sign-in/actions.ts` (commit 8).
 *
 * `next` is the optional path the partners-app middleware (commit 9)
 * tacks onto the sign-in URL when redirecting an unauthenticated
 * request — e.g. `/sign-in?next=/members`. The post-magic-link callback
 * then redirects there after exchanging the token for a session.
 *
 * Open-redirect protection: `next` must start with `/` and must not be
 * protocol-relative (`//evil.com`) — both shapes a browser can interpret
 * as cross-origin. The Server Action MUST use this schema (or the same
 * predicate) before consuming the value as a redirect target.
 *
 * Path-traversal (`/../foo`, `/%2e%2e/foo`) is left to Next.js routing
 * to normalise; an attacker can only reach in-app routes either way,
 * which is the same trust boundary as a normal navigation.
 */
export const SignInInputSchema = z.object({
  email: z.email(),
  next: z
    .string()
    .refine((val) => val.startsWith('/') && !val.startsWith('//'), {
      message:
        'next must be a relative path starting with "/" — absolute and protocol-relative URLs are rejected (open-redirect protection)',
    })
    .optional(),
});
export type SignInInput = z.infer<typeof SignInInputSchema>;
