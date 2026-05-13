import type { EmailTransport, RenderedEmail } from './types';

/**
 * E2E-only transport. Sends nothing — pushes the rendered message onto
 * an in-process queue that Playwright reads via a gated test-only
 * Route Handler in apps/partners (`/api/test/last-email`, only mounted
 * when E2E_MODE=1).
 *
 * Inbox storage: keyed off `globalThis` via `Symbol.for(...)` rather than
 * a module-level `const`. Next.js production builds load this module
 * separately for each runtime entry point — a Server Action chunk and
 * a Route Handler chunk import the same source file but receive their
 * own module instance, and a plain module-local array would mean the
 * writer and reader operate on disjoint buffers. The shared symbol
 * registry on `globalThis` survives that split because both module
 * instances resolve the same symbol identity.
 */
const INBOX_KEY = Symbol.for('strictons.email.memory.inbox');

type GlobalWithInbox = { [INBOX_KEY]?: RenderedEmail[] };
const g = globalThis as GlobalWithInbox;
const inbox: RenderedEmail[] = (g[INBOX_KEY] ??= []);

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
