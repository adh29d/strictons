import Link from 'next/link';
import { MAGIC_LINK_EXPIRY_MINUTES } from '@strictons/email/constants';

type SearchParams = Promise<{ email?: string }>;

export default async function CheckInboxPage({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<React.ReactElement> {
  const { email } = await searchParams;

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-2 text-2xl font-semibold">Check your inbox</h1>
      <p className="mb-4 text-sm text-neutral-700">
        {email ? (
          <>
            We sent a sign-in link to <strong>{email}</strong>. Click it to sign in.
          </>
        ) : (
          <>We sent you a sign-in link. Click it to sign in.</>
        )}
      </p>
      <p className="mb-4 text-sm text-neutral-600">
        The link expires in {MAGIC_LINK_EXPIRY_MINUTES} minutes.
      </p>
      <p className="text-sm">
        <Link href="/sign-in" className="underline">
          Send another link
        </Link>
      </p>
    </main>
  );
}
