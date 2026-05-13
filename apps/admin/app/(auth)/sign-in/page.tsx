import { isSafeNextPath } from '@strictons/db/auth-helpers';
import { SignInForm } from './SignInForm';

type SearchParams = Promise<{
  next?: string;
  error?: string;
}>;

/**
 * Admin-app sign-in page. Structural mirror of partners-app sign-in
 * with admin-context error copy. The error=no_access path activates
 * when commit 6 lands the admin middleware + /no-access redirect for
 * signed-in-but-not-Strictons-staff users — included now so the
 * routing wires up cleanly without a follow-up edit.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<React.ReactElement> {
  const { next, error } = await searchParams;
  const safeNext = isSafeNextPath(next) ? next : undefined;

  let errorMessage: string | null = null;
  if (error === 'expired') {
    errorMessage = 'That sign-in link expired or was already used. Send a new one below.';
  } else if (error === 'invalid') {
    errorMessage = "That sign-in link wasn't valid. Send a new one below.";
  } else if (error === 'no_access') {
    errorMessage =
      'You are signed in but your account is not a Strictons staff member. Contact another Strictons admin if this looks wrong.';
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-2 text-2xl font-semibold">Sign in to Strictons admin</h1>
      <p className="mb-6 text-sm text-neutral-600">
        Enter your email to receive a sign-in link. Strictons staff only.
      </p>
      {errorMessage ? (
        <p
          role="alert"
          className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {errorMessage}
        </p>
      ) : null}
      <SignInForm next={safeNext} />
    </main>
  );
}
