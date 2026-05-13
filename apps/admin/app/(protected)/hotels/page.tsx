import Link from 'next/link';
import { createServiceRoleClient } from '@strictons/db/client';

/**
 * Hotel list view.
 *
 * Server Component, force-dynamic so the rendered list reflects the
 * latest state (commit 8 lesson: revalidatePath drives re-renders on
 * mutation; force-dynamic prevents the route cache from masking
 * staleness on direct navigation).
 *
 * Read via service-role per Phase 2's locked decision: admin writes
 * are service-role-only, and the read side here uses the same client
 * for symmetry — RLS-enforced read works equally well for a staff user
 * via `hotels_select_strictons` policy, but service-role keeps the
 * data-fetch shape consistent across the list and the mutation paths
 * within this surface.
 */
export const dynamic = 'force-dynamic';

export default async function HotelsListPage(): Promise<React.ReactElement> {
  const service = createServiceRoleClient();
  const { data: hotels, error } = await service
    .from('hotels')
    .select('id, slug, name, contact_email, approval_state, custom_domain, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <h1 className="mb-4 text-2xl font-semibold">Hotels</h1>
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          Could not load hotels: {error.message}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Hotels</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {hotels?.length ?? 0} hotel{(hotels?.length ?? 0) === 1 ? '' : 's'}.
          </p>
        </div>
        <Link href="/hotels/new" className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
          Add hotel
        </Link>
      </header>

      {hotels && hotels.length > 0 ? (
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
          {hotels.map((h) => (
            <li key={h.id} className="px-4 py-3 text-sm">
              <Link
                href={`/hotels/${h.id}`}
                className="flex flex-col gap-1 hover:bg-neutral-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium">{h.name}</div>
                  <div className="text-xs text-neutral-600">
                    <code>{h.slug}</code>
                    {h.custom_domain ? <> · {h.custom_domain}</> : null}
                  </div>
                </div>
                <div className="flex flex-col items-start gap-1 text-xs text-neutral-600 sm:items-end">
                  <span>{h.approval_state}</span>
                  <span>{h.contact_email}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-600">
          No hotels yet.{' '}
          <Link href="/hotels/new" className="underline">
            Add the first one
          </Link>
          .
        </p>
      )}
    </main>
  );
}
