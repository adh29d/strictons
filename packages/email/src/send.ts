import { resolveTransport } from './client';
import { MAGIC_LINK_EXPIRY_MINUTES } from './constants';
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
const SUBJECT = 'Sign in to Strictons partners';

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
 * Phase 5 wiring (this commit): the body is a plaintext placeholder.
 * The real React Email template lands in commit 6 and replaces the
 * `html`/`text` builders below with rendered output. The transport
 * layer doesn't change between the two commits — it accepts the same
 * `RenderedEmail` shape either way.
 *
 * No retries — caller-side surfaces the error to the user, and users
 * can re-request the link. Bubbles `EmailSendError` from the transport
 * unchanged so callers can audit-log "send_failed" with a stable type.
 */
export async function sendMagicLink(input: SendMagicLinkInput): Promise<SendMagicLinkResult> {
  const expiresInMinutes = input.expiresInMinutes ?? MAGIC_LINK_EXPIRY_MINUTES;
  const transport = resolveTransport();

  const message: RenderedEmail = {
    to: input.to,
    from: process.env.SENDGRID_FROM ?? DEFAULT_FROM,
    replyTo: process.env.SENDGRID_REPLY_TO ?? DEFAULT_REPLY_TO,
    subject: SUBJECT,
    html: buildPlaceholderHtml(input.link, expiresInMinutes),
    text: buildPlaceholderText(input.link, expiresInMinutes),
  };

  await transport.send(message);

  return { transport: transport.name, to: input.to };
}

// ----------------------------------------------------------------------------
// Placeholder body builders.
//
// Replaced by `render.ts` + the React Email template in commit 6. Kept
// inline here so commit 5 has a working end-to-end send (`sendMagicLink`
// can be exercised by tests and the console transport) before the
// template arrives.
// ----------------------------------------------------------------------------

function buildPlaceholderText(link: string, expiresInMinutes: number): string {
  return [
    'Sign in to Strictons partners',
    '',
    `Click the link below to sign in. This link expires in ${expiresInMinutes} minutes.`,
    '',
    link,
    '',
    "If you didn't request this email, you can safely ignore it.",
    '',
    '— Strictons',
  ].join('\n');
}

function buildPlaceholderHtml(link: string, expiresInMinutes: number): string {
  return [
    '<p>Sign in to Strictons partners</p>',
    `<p>Click the link below to sign in. This link expires in ${expiresInMinutes} minutes.</p>`,
    `<p><a href="${escapeHtmlAttr(link)}">${escapeHtmlText(link)}</a></p>`,
    "<p>If you didn't request this email, you can safely ignore it.</p>",
    '<p>— Strictons</p>',
  ].join('\n');
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttr(s: string): string {
  return escapeHtmlText(s).replace(/"/g, '&quot;');
}
