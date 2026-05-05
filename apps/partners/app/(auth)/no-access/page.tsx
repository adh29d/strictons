import { redirect } from 'next/navigation';
import { createServerClient } from '@strictons/db/server';

/**
 * /no-access — the landing page for an authenticated user with no
 * hotel_users, business_users, or strictons_staff membership.
 *
 * Per C6, the page MUST include a visible sign-out CTA so a wedged user
 * has an obvious exit path. The form posts to /sign-out (POST-only,
 * commit 8) which clears the Supabase session via the SSR client and
 * redirects back to /sign-in.
 *
 * Middleware does not gate this route (see middleware.ts matcher);
 * instead the page authenticates here. An unauthenticated visitor is
 * redirected to /sign-in.
 *
 * A user who DOES have memberships visiting /no-access manually sees
 * the page as-is — edge case, no redirect to /. Worth the simplicity
 * tradeoff at this scope.
 *
 * Marked dynamic because the page reads request cookies via
 * createServerClient → next/headers cookies(). Without this Next tries
 * to statically prerender at build time, which fails closed on the C2
 * env-var-fail-loud check (NEXT_PUBLIC_SUPABASE_URL is not resolvable
 * during prerender).
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
        Signed in as <strong>{email}</strong>.
      </p>
      <p className="mb-4 text-sm text-neutral-700">
        This account doesn&apos;t have access to any hotels or businesses yet. If you were expecting
        an invite, ask your team admin to send one to this email address.
      </p>
      <form action="/sign-out" method="post">
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Sign out and try a different account
        </button>
      </form>
    </main>
  );
}
