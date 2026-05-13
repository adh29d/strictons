'use server';

import { redirect } from 'next/navigation';
import { withServerActionInstrumentation } from '@sentry/nextjs';
import { createServiceRoleClient } from '@strictons/db/client';
import { sendMagicLink, EmailSendError } from '@strictons/email/send';
import { MAGIC_LINK_EXPIRY_MINUTES } from '@strictons/email/constants';
import { SignInInputSchema } from '@strictons/types/auth';
import { writeAuditLog } from '@strictons/db/audit';
import { buildConfirmUrl, resolveAppUrl } from '@strictons/db/auth-helpers';
import type { SignInState } from './types';

/**
 * Environment-variable convention.
 *
 * Env vars are read inside the function body, never at module top-level.
 * Top-level reads run during Next.js build-time static analysis; when a
 * var is unset (CI, preview environments before configuration, vendored
 * builds) a top-level `process.env.X` evaluation can throw at import
 * time or freeze the resulting value into the build artefact. Reading
 * inside the function defers evaluation to first call, where a missing
 * var fails loudly with an actionable error and the dead-code
 * elimination boundary is unaffected.
 *
 * 'use server' rule: every export from this module must be an async
 * function. Type-only exports (TS-erased) and value re-exports are not
 * allowed — Next's runtime checker throws "A 'use server' file can only
 * export async functions, found object" on module load otherwise.
 * Move types to ./types.ts and constants to a non-'use server' sibling.
 *
 * Sentry instrumentation: every Server Action in the admin app is
 * wrapped in withServerActionInstrumentation per Phase 4 commit 2's
 * locked pattern. The wrapper flushes Sentry events via
 * vercelWaitUntil before the serverless function freezes, AND captures
 * unhandled throws with the original error preserved (bypassing Next's
 * production-mode sanitisation). `formData` is deliberately NOT passed
 * — the sign-in email is PII; passing formData would attach it as a
 * Sentry event extra regardless of sendDefaultPii=false.
 *
 * Magic-link send is unconditional (Phase 3 locked decision): we do
 * not gate at submission on whether the email is staff. Gating at
 * /no-access (commit 6) prevents user-enumeration via response-time
 * differences. The cost is one wasted email per non-staff request;
 * the security floor is no leakage of "is this email known to us?".
 */

const INITIAL_STATE: SignInState = {};

export async function signInWithEmail(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  return withServerActionInstrumentation('signInWithEmail', async (): Promise<SignInState> => {
    const rawEmail = (formData.get('email') ?? '').toString();
    const rawNextValue = (formData.get('next') ?? '').toString().trim();
    const rawNext = rawNextValue.length > 0 ? rawNextValue : undefined;

    const parsed = SignInInputSchema.safeParse({
      email: rawEmail,
      ...(rawNext !== undefined ? { next: rawNext } : {}),
    });
    if (!parsed.success) {
      return { error: 'Please enter a valid email address.', emailEcho: rawEmail };
    }
    const { email, next: parsedNext } = parsed.data;
    const next = parsedNext ?? '/';

    // Generate the magic-link token via service-role, then send the
    // email ourselves via SendGrid. Errors translate into a user-safe
    // state and an audit-log entry; success exits via redirect() (which
    // throws a NEXT_REDIRECT exception that must NOT be wrapped by
    // try/catch — Sentry's wrapper handles the special case).
    let sendSucceeded = false;
    try {
      const supabase = createServiceRoleClient();
      const adminUrl = resolveAppUrl('admin');

      const { data, error: generateError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
          redirectTo: `${adminUrl}/auth/confirm?next=${encodeURIComponent(next)}`,
        },
      });

      if (generateError) {
        // Bubble into the catch below so audit-logging is centralised.
        throw generateError;
      }

      // properties.hashed_token + verifyOtp({ type: 'email', token_hash })
      // is the response shape Phase 3 C1-verified against GoTrue. The
      // /auth/confirm Route Handler lands in commit 6.
      const tokenHash = (data?.properties as { hashed_token?: string } | undefined)
        ?.hashed_token;
      if (!tokenHash) {
        throw new Error(
          'admin.generateLink response missing properties.hashed_token; Supabase response shape changed unexpectedly',
        );
      }

      const link = buildConfirmUrl({
        appUrl: adminUrl,
        tokenHash,
        type: 'email',
        next,
      });

      await sendMagicLink({
        to: email,
        link,
        expiresInMinutes: MAGIC_LINK_EXPIRY_MINUTES,
      });

      await writeAuditLog({
        actor_user_id: null,
        actor_role: 'anonymous',
        action: 'sign_in_requested',
        entity_type: 'auth_attempt',
        entity_id: crypto.randomUUID(),
        after: {
          email,
          transport: process.env.EMAIL_TRANSPORT ?? 'console',
        },
      });

      sendSucceeded = true;
    } catch (cause) {
      const reason = cause instanceof EmailSendError ? 'send_failed' : 'generate_link_failed';

      await writeAuditLog({
        actor_user_id: null,
        actor_role: 'anonymous',
        action: 'sign_in_send_failed',
        entity_type: 'auth_attempt',
        entity_id: crypto.randomUUID(),
        after: {
          email,
          reason,
          message: cause instanceof Error ? cause.message : String(cause),
        },
      });

      return {
        error: "Couldn't send the email, please try again.",
        emailEcho: email,
      };
    }

    if (sendSucceeded) {
      redirect(`/sign-in/check-inbox?email=${encodeURIComponent(email)}`);
    }
    return INITIAL_STATE;
  });
}
