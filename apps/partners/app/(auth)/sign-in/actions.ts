'use server';

import { redirect } from 'next/navigation';
import { createServiceRoleClient } from '@strictons/db/client';
import { sendMagicLink, EmailSendError } from '@strictons/email/send';
import { MAGIC_LINK_EXPIRY_MINUTES } from '@strictons/email/constants';
import { SignInInputSchema } from '@strictons/types/auth';
import { writeAuditLog } from '@/lib/audit';
import {
  buildConfirmUrl,
  maskGenerateLinkResponseForVerification,
  resolvePartnersUrl,
} from '@/lib/auth-link';

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
 */

export type SignInState = {
  error?: string;
  emailEcho?: string;
};

const INITIAL_STATE: SignInState = {};

export async function signInWithEmail(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
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

  // Generate the magic-link token via service-role, then send the email
  // ourselves via SendGrid. Errors translate into a user-safe state and
  // an audit-log entry; success exits via redirect() (which throws a
  // NEXT_REDIRECT exception that must NOT be wrapped by try/catch).
  let sendSucceeded = false;
  try {
    const supabase = createServiceRoleClient();
    const partnersUrl = resolvePartnersUrl();

    const { data, error: generateError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        redirectTo: `${partnersUrl}/auth/confirm?next=${encodeURIComponent(next)}`,
      },
    });

    if (generateError) {
      // Bubble into the catch below so audit-logging is centralised.
      throw generateError;
    }

    // ┌─────────────────────────────────────────────────────────────────┐
    // │  C1 EMPIRICAL VERIFICATION (commit 8 first push only)            │
    // │                                                                  │
    // │  Logs the masked admin.generateLink response shape so we can    │
    // │  confirm (a) which field carries the token_hash, (b) which     │
    // │  `type` value GoTrue accepts when the partner Route Handler    │
    // │  later calls verifyOtp({type, token_hash}). The plan codes      │
    // │  against properties.hashed_token + type='email'; this log       │
    // │  proves or refutes that pairing against the actual local       │
    // │  Supabase image. Removed at commit 9 (or earlier follow-up)     │
    // │  once the shape is locked in. See PR description.               │
    // └─────────────────────────────────────────────────────────────────┘
    console.info(
      '[c1-verify] admin.generateLink response shape (masked):',
      JSON.stringify(maskGenerateLinkResponseForVerification(data), null, 2),
    );

    const tokenHash = (data?.properties as { hashed_token?: string } | undefined)?.hashed_token;
    if (!tokenHash) {
      throw new Error(
        'admin.generateLink response missing properties.hashed_token; the C1-verification round revealed an unexpected shape',
      );
    }

    const link = buildConfirmUrl({
      partnersUrl,
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
    // C7 shape: actor anonymous, entity_type 'auth_attempt', entity_id
    // a fresh uuid, after carries the failure reason. Useful security
    // signal for credential-stuffing or "user thinks they're invited
    // but isn't" patterns. Rate-limiting deferred per Q6.
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
}
