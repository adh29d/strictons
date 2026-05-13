import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerClient } from '@strictons/db/server';

/**
 * Admin-app post-sign-in landing.
 *
 * Reachable only via the middleware's allow decision, which only
 * passes for users with public.strictons_staff membership (commit 5
 * wired the real query; commit 6 wired the middleware predicate).
 * Replaces the Phase 1 / placeholder.
 *
 * force-dynamic so the rendered staff email reflects the live
 * session, not a build-time cached value — same reasoning as
 * /no-access.
 *
 * PII note: this page renders the signed-in staff user's email.
 * Acceptable for an admin landing — staff are signed in to their
 * own session, and the value is already in the cookie. Worth
 * flagging here so a future maintainer adding broader user context
 * (display_name, last_signed_in_at, etc.) thinks about the same
 * server-rendered-PII boundary.
 *
 * Defence-in-depth: even though middleware should never let a non-
 * authenticated user past, this page re-authenticates via
 * createServerClient before rendering. A null user redirects to
 * /sign-in rather than failing closed with a 500. The middleware-
 * skipped paths (sign-in, sign-out, auth/confirm, no-access,
 * _next/*) don't reach here.
 */
export const dynamic = 'force-dynamic';

export default async function AdminLandingPage(): Promise<React.ReactElement> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/sign-in');
  }

  const email = user.email ?? 'your account';

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Strictons admin</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Signed in as <strong>{email}</strong>.
          </p>
        </div>
        <form action="/sign-out" method="post">
          <button
            type="submit"
            className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="rounded border border-neutral-200 p-6">
        <h2 className="mb-2 text-lg font-medium">Hotels</h2>
        <p className="mb-4 text-sm text-neutral-700">
          Manage hotels: list, add, edit, and update approval state and custom-domain attachments.
        </p>
        <Link
          href="/hotels"
          className="inline-block rounded bg-neutral-900 px-4 py-2 text-sm text-white"
        >
          Open hotel CRUD
        </Link>
      </section>
    </main>
  );
}
