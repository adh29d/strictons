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
 *   EMAIL_TRANSPORT=sendgrid → real SendGrid send
 *   EMAIL_TRANSPORT=memory   → in-process buffer (E2E_MODE only)
 *   EMAIL_TRANSPORT=console  → console.log
 *   unset                    → console (safe default for local dev)
 *
 * `memory` additionally requires `E2E_MODE=1` so a misconfigured preview
 * deploy can never silently swallow real magic-link emails into a
 * process-local queue.
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
