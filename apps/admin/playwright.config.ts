import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the admin-app E2E suite.
 *
 * Mirrors apps/partners/playwright.config.ts in shape (production
 * build, EMAIL_TRANSPORT=memory, E2E_MODE=1, single worker, stdout
 * piped). Differences:
 *
 *   - Port 3001 (admin) instead of 3002 (partners)
 *   - NEXT_PUBLIC_PARTNERS_URL passed through so the magic-link
 *     helper in apps/admin/app/(protected)/hotels/[id]/_lib/
 *     hotel-admin-magic-link.ts constructs cross-app links pointing
 *     at the partners app (the SUT for the staff-initiated invite
 *     flow's reconciliation step)
 *   - E2E_PARTNERS_URL passed through so the cross-app spec
 *     (invite-hotel-admin.spec.ts) can navigate to the partners app
 *     directly via `page.goto(process.env.E2E_PARTNERS_URL + ...)`
 *     after extracting the magic link from the memory inbox
 *
 * Cross-app E2E pattern (Phase 5 commit 6):
 *   - This config's webServer boots ONLY admin on :3001
 *   - The partners app must be running separately on
 *     E2E_PARTNERS_URL (locally: pnpm dev; in CI: a background
 *     process started by .github/workflows/e2e-admin.yml)
 *   - We deliberately do NOT add a second `webServer` entry here —
 *     doubles cold-start cost on every admin E2E run including
 *     specs that don't touch partners (Phase 5 plan §6 lock).
 *
 * Local run:
 *   # In one terminal:
 *   pnpm --filter @strictons/partners build
 *   pnpm --filter @strictons/partners start
 *   # In another terminal:
 *   pnpm --filter @strictons/admin build
 *   pnpm --filter @strictons/admin test:e2e
 *
 * Or with pnpm dev (uses next dev rather than the production build,
 * which is fine for local iteration):
 *   pnpm dev   # boots all four apps
 *   E2E_PARTNERS_URL=http://localhost:3002 \
 *     pnpm --filter @strictons/admin exec playwright test
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3001/sign-in',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // Memory transport: sendHotelAdminInvite / sendHotelAdminResend
      // (and sendMagicLink for staff sign-in) push into the in-process
      // inbox the /api/test/last-email route reads. The route 404s
      // unless E2E_MODE=1, mirroring the partners-side gate exactly.
      EMAIL_TRANSPORT: 'memory',
      E2E_MODE: '1',

      // Supabase env vars passed through from the host environment
      // (CI's e2e-admin.yml boots local Supabase and exports these;
      // locally Steven points at strictons-dev or a local boot).
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? '',

      // Where admin-side magic-link emails redirect. The cross-app
      // spec navigates to the link extracted from the inbox, which
      // resolves against this URL. Default localhost:3002 in both
      // local + CI; the partners app must be running there.
      NEXT_PUBLIC_PARTNERS_URL: process.env.NEXT_PUBLIC_PARTNERS_URL ?? 'http://localhost:3002',

      // Admin's own externally-reachable URL — used by the admin
      // sign-in Server Action when constructing its own /auth/confirm
      // link. Matches the admin webServer port.
      NEXT_PUBLIC_ADMIN_URL: process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3001',

      // Cross-app navigation target read by the spec body. Pass
      // through from host env (CI sets it; local default below).
      E2E_PARTNERS_URL: process.env.E2E_PARTNERS_URL ?? 'http://localhost:3002',

      // SendGrid SDK reads SENDGRID_API_KEY on first send even when
      // the memory transport handles the actual delivery — placeholder
      // keeps the env-var-fail-loud check happy.
      SENDGRID_API_KEY: 'SG.placeholder-not-used-in-e2e',
    },
  },
});
