import { resolveTransport } from './client';
import { MAGIC_LINK_EXPIRY_MINUTES } from './constants';
import { renderMagicLink } from './render';
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
