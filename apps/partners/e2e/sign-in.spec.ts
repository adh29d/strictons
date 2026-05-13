import { test, expect } from '@playwright/test';

/**
 * Magic-link sign-in flow E2E.
 *
 * Covers the end-to-end path approved for Phase 3:
 *   1. Visit /sign-in, submit a fresh email
 *   2. Land on /sign-in/check-inbox
 *   3. Read the magic-link email from the in-process memory transport
 *      via the gated /api/test/last-email route handler
 *   4. Visit the link → verifyOtp succeeds → land on /no-access
 *      (the email has no membership row in the test database, so
 *      middleware sends an authenticated-but-wedged user there)
 *   5. Sign out → land back on /sign-in, session cleared
 *
 * Invite + revoke flows are out of scope for Phase 3 per the plan;
 * those exercise the same Server Actions but require seeded fixtures.
 *
 * The test uses a fresh email per run (suffixed with Date.now()) so
 * repeated runs against the same Supabase project don't collide on
 * the auth.users unique-email constraint.
 */
test.describe('partners magic-link sign-in', () => {
  test('request → consume → no-access → sign-out', async ({ page, request }) => {
    const email = `e2e-${Date.now()}@example.test`;

    // ---- 1. Request the magic link --------------------------------------
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();

    // ---- 2. Land on /sign-in/check-inbox --------------------------------
    await page.waitForURL('**/sign-in/check-inbox**');
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    // ---- 3. Read the rendered email from the memory transport -----------
    // Tiny poll loop in case the Server Action's redirect races the
    // transport-side enqueue. The memory transport stores synchronously,
    // so a single read should suffice; the loop is belt-and-braces.
    let entry: {
      to: string;
      subject: string;
      text: string;
      html: string;
    } | null = null;
    for (let i = 0; i < 10 && !entry; i++) {
      const res = await request.get(`/api/test/last-email?to=${encodeURIComponent(email)}`);
      if (res.ok()) {
        const body = (await res.json()) as { entry: typeof entry };
        if (body.entry) {
          entry = body.entry;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(entry, 'magic-link email should land in the memory inbox').not.toBeNull();
    expect(entry!.subject).toBe('Sign in to Strictons partners');

    // Pull the magic-link URL out of the plain-text body. The template
    // (commit 6) puts the link on its own line in the text part.
    const linkMatch = entry!.text.match(/https?:\/\/[^\s]+\/auth\/confirm\?[^\s]+/);
    expect(linkMatch, 'plain-text body should contain a /auth/confirm link').not.toBeNull();
    const linkUrl = linkMatch![0];

    // The Server Action builds the link from NEXT_PUBLIC_PARTNERS_URL,
    // which the playwright.config.ts sets to http://localhost:3002 —
    // the link should already point at our test server. Sanity-check.
    expect(linkUrl).toContain('http://localhost:3002/auth/confirm');

    // ---- 4. Consume the magic link -------------------------------------
    await page.goto(linkUrl);

    // The fresh email has no membership row, so middleware lands the
    // user on /no-access after verifyOtp succeeds.
    await page.waitForURL('**/no-access');
    await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    // ---- 5. Sign out ---------------------------------------------------
    await page.getByRole('button', { name: 'Sign out and try a different account' }).click();
    await page.waitForURL('**/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // After sign-out, hitting a protected route should bounce back to
    // /sign-in (cookies are cleared). Belt-and-braces verification.
    await page.goto('/');
    await page.waitForURL('**/sign-in**');
  });
});
