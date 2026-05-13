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

export function createMemoryTransport(): EmailTransport {
  return {
    name: 'memory',
    async send(message: RenderedEmail): Promise<void> {
      inbox.push(message);
    },
  };
}

export function readMemoryInbox(): readonly RenderedEmail[] {
  return inbox;
}

export function findMemoryInboxEntry(toEmail: string): RenderedEmail | undefined {
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
