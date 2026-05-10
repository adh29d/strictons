import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@strictons/ui', '@strictons/types'],
};

/**
 * Sentry's withSentryConfig wraps the Next config to register webpack
 * hooks that emit Sentry's per-route bundle metadata. SDK + DSN only
 * this phase per Q5 — no `authToken`, `org`, or `project` set, so
 * source-map upload is disabled. Errors symbolicate via Sentry's
 * release fingerprinting only.
 *
 * `silent: !process.env.CI` mirrors Sentry's recommended pattern —
 * suppresses Sentry's build-time logs in local dev while keeping them
 * visible in CI.
 *
 * `hideSourceMaps: true` ensures generated source maps (Next still
 * emits them for its own dev experience) are not exposed publicly via
 * the production bundle's URLs.
 */
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  hideSourceMaps: true,
  disableLogger: true,
});
