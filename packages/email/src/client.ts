import type { EmailTransport } from './transports/types';
import { createSendgridTransport } from './transports/sendgrid';
import { createConsoleTransport } from './transports/console';
import { createMemoryTransport } from './transports/memory';

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
 * Resolve the active email transport from the environment.
 *
 * Selection rule (read at first call):
 *
 *   EMAIL_TRANSPORT=sendgrid → real SendGrid send
 *   EMAIL_TRANSPORT=memory   → in-process buffer (E2E_MODE only)
 *   EMAIL_TRANSPORT=console  → console.log only (no email sent)
 *   unset                    → console.log only (no email sent)
 *   any other value          → throws
 *
 * Default-when-unset is `console`, not `sendgrid`. There is no
 * auto-detect by NODE_ENV / VERCEL_ENV / hostname — any deployment
 * that must send real email needs to set EMAIL_TRANSPORT=sendgrid
 * explicitly, including production. This is a deliberate safe-by-
 * default posture (a misconfigured preview cannot silently send
 * real email at developers and end users), but it means a freshly-
 * configured Vercel project that omits EMAIL_TRANSPORT will silently
 * console-log every magic-link request and the recipient will never
 * receive an email. Phase 4 commit 4 verification paid one diagnostic
 * cycle on this.
 *
 * `memory` additionally requires `E2E_MODE=1` so a misconfigured
 * preview deploy can never silently swallow real magic-link emails
 * into a process-local queue.
 *
 * Operational convention (Phase 4 onwards): EMAIL_TRANSPORT is a
 * cross-app value and lives in Vercel's TEAM-SHARED env vars, so
 * every app project inherits the same transport choice. Per-project
 * overrides are still possible if a single app needs a different
 * transport for testing.
 */
export function resolveTransport(): EmailTransport {
  const choice = process.env.EMAIL_TRANSPORT?.toLowerCase().trim() ?? '';

  if (choice === 'sendgrid') return createSendgridTransport();

  if (choice === 'memory') {
    if (process.env.E2E_MODE !== '1') {
      throw new Error(
        'resolveTransport: EMAIL_TRANSPORT=memory requires E2E_MODE=1; refusing to swallow emails silently in a non-E2E environment',
      );
    }
    return createMemoryTransport();
  }

  if (choice === 'console' || choice === '') return createConsoleTransport();

  throw new Error(
    `resolveTransport: unknown EMAIL_TRANSPORT=${choice}; expected one of sendgrid|memory|console`,
  );
}
