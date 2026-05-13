import type { Page, APIRequestContext } from '@playwright/test';

/**
 * Admin-app sign-in helper via the full magic-link flow.
 *
 * Structurally identical to apps/partners/e2e/helpers/magic-link.ts —
 * same memory-transport inbox read pattern via /api/test/last-email,
 * same polling loop tolerance for the Server Action enqueue race,
 * same waitForURL pattern after the consume redirects.
 *
 * Differences from the partners helper:
 *   - Sign-in URL is /sign-in on admin (not /partners/sign-in)
 *   - The admin form's submit button reads 'Send sign-in link' —
 *     same as the partners form (Phase 4 mirrors it verbatim)
 *
 * The CI port-readiness wait (in .github/workflows/e2e-admin.yml)
 * is a process-boot sentinel, structurally distinct from a
 * test-body sleep. This helper has no sleeps inside the test body
 * — the 200ms polling tick for the inbox read is bounded retry
 * for the Server Action enqueue race, not race-masking slack.
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
    throw new Error(`signInWithMagicLink: no /auth/confirm URL in plain-text body for ${email}`);
  }

  await page.goto(linkMatch[0]);
  // /auth/confirm redirects on completion; wait for the destination.
  await page.waitForURL((url) => !url.toString().includes('/auth/confirm'));
}
