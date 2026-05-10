import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the partners-app magic-link E2E.
 *
 * Pattern:
 *   - `webServer` boots `pnpm start` against the production build with
 *     EMAIL_TRANSPORT=memory and E2E_MODE=1 set, so sendMagicLink
 *     pushes into an in-process buffer instead of hitting SendGrid
 *     and the test-only `/api/_test/last-email` route is reachable
 *   - Supabase env vars (URL / publishable / secret keys) are read
 *     from the host environment — CI's e2e.yml workflow boots local
 *     Supabase and exports them; locally Steven points at strictons-dev
 *     or a local boot
 *   - Sentry is intentionally NOT configured (NEXT_PUBLIC_SENTRY_DSN
 *     unset) so test runs don't emit telemetry to the real Sentry
 *     project
 *   - Single worker, sequential execution — auth flows have shared
 *     in-memory inbox state; parallel runs would race
 *
 * Local run:
 *   pnpm --filter @strictons/partners build
 *   pnpm --filter @strictons/partners test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:3002',
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
    url: 'http://localhost:3002/sign-in',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      // Email transport configuration: in-memory inbox the test reads
      // via /api/_test/last-email. The route handler 404s unless
      // E2E_MODE=1, so production-shaped deploys can never accidentally
      // expose the inbox.
      EMAIL_TRANSPORT: 'memory',
      E2E_MODE: '1',

      // Supabase env vars passed through from the host environment
      // (CI's e2e.yml workflow boots local Supabase and sets these).
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? '',

      // Where Server Actions point the magic-link redirect target.
      // Local-only host so the link Playwright clicks resolves on
      // the test server.
      NEXT_PUBLIC_PARTNERS_URL: 'http://localhost:3002',

      // SendGrid not used in E2E (memory transport handles sends),
      // but the SendGrid SDK still tries to readApiKey on first send;
      // a placeholder keeps the env-var-fail-loud check happy.
      SENDGRID_API_KEY: 'SG.placeholder-not-used-in-e2e',
    },
  },
});
