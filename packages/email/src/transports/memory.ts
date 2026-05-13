import type { EmailTransport, RenderedEmail } from './types';

/**
 * E2E-only transport. Sends nothing — pushes the rendered message onto
 * an in-process queue that Playwright reads via a gated test-only
 * Route Handler in apps/partners (`/api/test/last-email`, only mounted
 * when E2E_MODE=1).
 *
 * Module-level singleton: every caller sees the same buffer. Tests that
 * need isolation use `clearMemoryInbox()` between cases.
 */
const inbox: RenderedEmail[] = [];

// DIAGNOSTIC (commit 14 failure investigation): per-module-load id so
// writer-vs-reader logs can disambiguate the "two-module-copies"
// hypothesis. If push and read log different ids, Next bundled this
// transport twice and each copy owns its own inbox. Gated on
// E2E_MODE=1 so vitest unit tests (which don't set it) stay quiet.
const MODULE_ID = `mem-${Math.random().toString(36).slice(2, 10)}`;
const DIAG = process.env.E2E_MODE === '1';
if (DIAG) console.log(`[diag][memory] module loaded id=${MODULE_ID}`);

export function createMemoryTransport(): EmailTransport {
  return {
    name: 'memory',
    async send(message: RenderedEmail): Promise<void> {
      inbox.push(message);
      if (DIAG)
        console.log(
          `[diag][memory] push id=${MODULE_ID} to=${message.to} length_after=${inbox.length}`,
        );
    },
  };
}

export function readMemoryInbox(): readonly RenderedEmail[] {
  return inbox;
}

export function findMemoryInboxEntry(toEmail: string): RenderedEmail | undefined {
  if (DIAG) console.log(`[diag][memory] read id=${MODULE_ID} to=${toEmail} length=${inbox.length}`);
  // Most recent send to this address wins — multiple sign-in attempts
  // share an inbox; the test cares about the latest link.
  for (let i = inbox.length - 1; i >= 0; i--) {
    if (inbox[i]!.to === toEmail) return inbox[i];
  }
  return undefined;
}

export function clearMemoryInbox(): void {
  inbox.length = 0;
}
