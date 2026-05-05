/**
 * Common shape every email transport accepts.
 *
 * The fields are deliberately renderer-agnostic — the transport doesn't
 * know whether the body came from a React Email template, a hand-written
 * MJML string, or a console-friendly placeholder. `send.ts` is the
 * boundary that renders the template and hands the transport an inert
 * payload.
 */
export type RenderedEmail = {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
};

export type EmailTransport = {
  /**
   * Symbolic name used in error messages and audit logs. One of:
   *   - 'sendgrid'   real SendGrid v3 send (production, preview)
   *   - 'console'    console.log; engineers click the link in the log
   *                  (default in local dev)
   *   - 'memory'     in-process buffer; only enabled when E2E_MODE=1
   *                  (Playwright reads the link from the buffer via a
   *                   gated test-only Route Handler in apps/partners)
   */
  name: 'sendgrid' | 'console' | 'memory';
  send(message: RenderedEmail): Promise<void>;
};

/**
 * Stable error class so callers (Server Actions, audit-log writers)
 * can recognise transport-layer failures without sniffing message
 * strings.
 *
 * Carries the transport name and the original cause so audit_log
 * entries record both the operational layer that failed and the
 * underlying error.
 */
export class EmailSendError extends Error {
  constructor(
    public readonly transport: EmailTransport['name'],
    public readonly to: string,
    cause: unknown,
  ) {
    super(
      `EmailSendError(transport=${transport}, to=${to}): ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'EmailSendError';
    this.cause = cause;
  }
}
