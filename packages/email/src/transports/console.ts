import type { EmailTransport, RenderedEmail } from './types';

/**
 * Local-dev transport. Logs the rendered message to stdout so engineers
 * running `pnpm dev` can read the magic-link URL out of the terminal
 * and click through the flow without configuring SendGrid.
 *
 * Default when EMAIL_TRANSPORT is unset.
 */
export function createConsoleTransport(): EmailTransport {
  return {
    name: 'console',
    async send(message: RenderedEmail): Promise<void> {
      console.log(
        [
          '────── @strictons/email (console transport) ──────',
          `To:      ${message.to}`,
          `From:    ${message.from}`,
          message.replyTo ? `ReplyTo: ${message.replyTo}` : null,
          `Subject: ${message.subject}`,
          '',
          message.text,
          '──────────────────────────────────────────────────',
        ]
          .filter((l) => l !== null)
          .join('\n'),
      );
    },
  };
}
