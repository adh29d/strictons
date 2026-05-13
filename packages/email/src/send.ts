import { resolveTransport } from './client';
import { MAGIC_LINK_EXPIRY_MINUTES } from './constants';
import { renderHotelAdminInvite, renderHotelAdminResend, renderMagicLink } from './render';
import type { EmailTransport, RenderedEmail } from './transports/types';

export type { EmailTransport } from './transports/types';
export { EmailSendError } from './transports/types';

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

const DEFAULT_FROM = 'welcome@strictons.com';
const DEFAULT_REPLY_TO = 'welcome@strictons.com';

export type SendMagicLinkInput = {
  to: string;
  link: string;
  /**
   * Override only when callers need to test a non-default expiry.
   * Production always uses MAGIC_LINK_EXPIRY_MINUTES.
   */
  expiresInMinutes?: number;
};

export type SendMagicLinkResult = {
  transport: EmailTransport['name'];
  to: string;
};

/**
 * Send the magic-link sign-in email.
 *
 * No retries — caller-side surfaces the error to the user, and users
 * can re-request the link. Bubbles `EmailSendError` from the transport
 * unchanged so callers can audit-log "send_failed" with a stable type.
 */
export async function sendMagicLink(input: SendMagicLinkInput): Promise<SendMagicLinkResult> {
  const expiresInMinutes = input.expiresInMinutes ?? MAGIC_LINK_EXPIRY_MINUTES;
  const transport = resolveTransport();

  const { subject, html, text } = renderMagicLink({
    link: input.link,
    expiresInMinutes,
  });

  const message: RenderedEmail = {
    to: input.to,
    from: process.env.SENDGRID_FROM ?? DEFAULT_FROM,
    replyTo: process.env.SENDGRID_REPLY_TO ?? DEFAULT_REPLY_TO,
    subject,
    html,
    text,
  };

  await transport.send(message);

  return { transport: transport.name, to: input.to };
}

// ----------------------------------------------------------------------------
// Hotel-admin invite (Phase 5, Surface 1) — staff invites a hotel admin
// ----------------------------------------------------------------------------

export type SendHotelAdminInviteInput = {
  to: string;
  link: string;
  hotelName: string;
  /**
   * Override only when callers need to test a non-default expiry.
   * Production always uses MAGIC_LINK_EXPIRY_MINUTES.
   */
  expiresInMinutes?: number;
};

export type SendHotelAdminInviteResult = {
  transport: EmailTransport['name'];
  to: string;
};

/**
 * Send the first-touch hotel-admin invitation email.
 *
 * Triggered by Strictons staff from the admin app's hotel edit page.
 * The recipient is being added as the admin for `hotelName` and has
 * not yet seen the portal — the template's copy is welcoming.
 *
 * No retries — same posture as sendMagicLink. Bubbles `EmailSendError`
 * from the transport unchanged so callers can audit-log
 * `hotel_admin_invite_failed` with a stable type.
 */
export async function sendHotelAdminInvite(
  input: SendHotelAdminInviteInput,
): Promise<SendHotelAdminInviteResult> {
  const expiresInMinutes = input.expiresInMinutes ?? MAGIC_LINK_EXPIRY_MINUTES;
  const transport = resolveTransport();

  const { subject, html, text } = renderHotelAdminInvite({
    link: input.link,
    expiresInMinutes,
    hotelName: input.hotelName,
  });

  const message: RenderedEmail = {
    to: input.to,
    from: process.env.SENDGRID_FROM ?? DEFAULT_FROM,
    replyTo: process.env.SENDGRID_REPLY_TO ?? DEFAULT_REPLY_TO,
    subject,
    html,
    text,
  };

  await transport.send(message);

  return { transport: transport.name, to: input.to };
}

// ----------------------------------------------------------------------------
// Hotel-admin resend (Phase 5, Surface 2) — staff resends the portal link
// ----------------------------------------------------------------------------

export type SendHotelAdminResendInput = {
  to: string;
  link: string;
  hotelName: string;
  expiresInMinutes?: number;
};

export type SendHotelAdminResendResult = {
  transport: EmailTransport['name'];
  to: string;
};

/**
 * Send the routine portal-access-link resend email.
 *
 * Triggered by Strictons staff from a per-row "Resend portal access
 * link" affordance on the hotel edit page. The recipient already has
 * a hotel_users row — the template's copy is utilitarian.
 *
 * No retries; bubbles `EmailSendError` from the transport unchanged so
 * callers can audit-log `portal_access_link_resend_failed`.
 */
export async function sendHotelAdminResend(
  input: SendHotelAdminResendInput,
): Promise<SendHotelAdminResendResult> {
  const expiresInMinutes = input.expiresInMinutes ?? MAGIC_LINK_EXPIRY_MINUTES;
  const transport = resolveTransport();

  const { subject, html, text } = renderHotelAdminResend({
    link: input.link,
    expiresInMinutes,
    hotelName: input.hotelName,
  });

  const message: RenderedEmail = {
    to: input.to,
    from: process.env.SENDGRID_FROM ?? DEFAULT_FROM,
    replyTo: process.env.SENDGRID_REPLY_TO ?? DEFAULT_REPLY_TO,
    subject,
    html,
    text,
  };

  await transport.send(message);

  return { transport: transport.name, to: input.to };
}
