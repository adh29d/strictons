import { redirect } from 'next/navigation';
import { createServerClient } from '@strictons/db/server';

/**
 * /no-access — the landing page for an authenticated user who is not
 * recognised as Strictons staff (i.e. has no row in
 * public.strictons_staff). Distinct from the partners-side /no-access
 * copy: admin's wedge state is exclusively about staff membership,
 * never about hotel or business roles.
 *
 * The page MUST include a visible sign-out CTA so a wedged user has
 * an obvious exit path. The form posts to /sign-out which clears the
 * Supabase session via the SSR client and redirects back to /sign-in.
 *
 * Middleware does not gate this route (see middleware.ts matcher);
 * instead the page authenticates here. An unauthenticated visitor is
 * redirected to /sign-in.
 *
 * A staff user visiting /no-access manually sees the page as-is — edge
 * case, no redirect to /. Worth the simplicity tradeoff at this scope.
 *
 * Marked force-dynamic so the rendered email reflects the LIVE session,
 * not a build-time cached value. Without this Next tries to statically
 * prerender at build time, which (a) fails closed on the env-var
 * fail-loud check (NEXT_PUBLIC_SUPABASE_URL is not resolvable during
 * prerender), and (b) would serve a stale email for the wrong user
 * even if it succeeded.
 */
export const dynamic = 'force-dynamic';

export default async function NoAccessPage(): Promise<React.ReactElement> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/sign-in');
  }

  const email = user.email ?? 'your account';

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-2 text-2xl font-semibold">No access</h1>
      <p className="mb-4 text-sm text-neutral-700">
        Signed in as <strong>{email}</strong>, but this account isn&apos;t recognised as Strictons
        staff.
      </p>
      <p className="mb-4 text-sm text-neutral-700">
        If you believe this is an error, contact another Strictons admin. If you meant to sign in to
        the hotel or business partner portal, you want{' '}
        <a href="https://partners.strictons.com" className="underline">
          partners.strictons.com
        </a>{' '}
        instead.
      </p>
      <form action="/sign-out" method="post">
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Sign out and try a different account
        </button>
      </form>
    </main>
  );
}
