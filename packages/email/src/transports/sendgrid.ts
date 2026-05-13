import sgMail from '@sendgrid/mail';
import type { EmailTransport, RenderedEmail } from './types';
import { EmailSendError } from './types';

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
 * Production / preview transport.
 *
 * Calls SendGrid v3 `/mail/send` via the official SDK. No retry inside
 * `send()` this phase — Phase 3 §6 plan: caller-side surfaces the error
 * to the user and lets them re-request the link. Retries belong in the
 * cron-style senders coming in later phases (approval reminders,
 * renewal reports, etc.).
 *
 * Reads SENDGRID_API_KEY at first send, not at import time.
 */
export function createSendgridTransport(): EmailTransport {
  let configured = false;

  return {
    name: 'sendgrid',
    async send(message: RenderedEmail): Promise<void> {
      if (!configured) {
        const key = process.env.SENDGRID_API_KEY;
        if (!key) {
          throw new EmailSendError(
            'sendgrid',
            message.to,
            new Error('SENDGRID_API_KEY is required'),
          );
        }
        sgMail.setApiKey(key);
        configured = true;
      }

      try {
        await sgMail.send({
          to: message.to,
          from: message.from,
          replyTo: message.replyTo,
          subject: message.subject,
          html: message.html,
          text: message.text,
        });
      } catch (cause) {
        throw new EmailSendError('sendgrid', message.to, cause);
      }
    },
  };
}
