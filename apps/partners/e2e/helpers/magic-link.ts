import type { Page, APIRequestContext } from '@playwright/test';

/**
 * Helper: sign in an email via the full magic-link flow, ending with
 * the browser landed on whatever post-sign-in destination middleware
 * routes to (/, /no-access, /<protected>/…). Used by specs that need
 * to authenticate one or more users without duplicating the
 * walkthrough inline.
 *
 * The /api/test/last-email route handler reads the in-process memory
 * transport's inbox. The transport itself lives on globalThis keyed
 * by Symbol.for(...) so writer and reader chunks see the same state
 * (Phase 3 module-instance-split fix); the spec does not access the
 * inbox via a separate import — it reads through the Route Handler.
 *
 * The retry loop tolerates a brief race between the Server Action's
 * redirect and the transport's enqueue. The memory transport is
 * synchronous, so one read is usually sufficient.
 */
export async function signInWithMagicLink({
  page,
  request,
  email,
}: {
  page: Page;
  request: APIRequestContext;
  email: string;
}): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  await page.waitForURL('**/sign-in/check-inbox**');

  type InboxEntry = { to: string; subject: string; text: string; html: string };
  let entry: InboxEntry | null = null;
  for (let i = 0; i < 20 && !entry; i++) {
    const res = await request.get(`/api/test/last-email?to=${encodeURIComponent(email)}`);
    if (res.ok()) {
      const body = (await res.json()) as { entry: InboxEntry | null };
      if (body.entry) {
        entry = body.entry;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!entry) {
    throw new Error(`signInWithMagicLink: no magic-link email for ${email} after 4s polling`);
  }
  const found: InboxEntry = entry;

  const linkMatch = found.text.match(/https?:\/\/[^\s]+\/auth\/confirm\?[^\s]+/);
  if (!linkMatch) {
    throw new Error(
      `signInWithMagicLink: no /auth/confirm URL in plain-text body for ${email}`,
    );
  }

  await page.goto(linkMatch[0]);
  // /auth/confirm redirects on completion; wait for the destination.
  await page.waitForURL((url) => !url.toString().includes('/auth/confirm'));
}
