import { createServiceRoleClient } from '@strictons/db/client';
import { RemoveCandidateButton } from './remove-candidate-button';

/**
 * Server Component — never imported from a 'use client' module.
 * Reads the hotel's alive candidate_businesses rows via service-role
 * (Strictons staff bypasses RLS on this surface per the Phase 2
 * locked decision).
 *
 * `removed_at IS NULL` is the alive filter — it matches the predicate
 * of the migration-15 partial unique index. Removed rows are not shown
 * (no show-removed toggle in this commit; §4's RemovedCandidatesPanel
 * is deferred).
 *
 * Re-renders on revalidatePath('/hotels/[id]/candidates') from the
 * sibling candidate Server Actions, so a successful add or remove
 * updates this table without a manual reload. The page is
 * force-dynamic per the page.tsx — this component inherits that.
 */
type Props = {
  hotelId: string;
};

type CandidateRow = {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  phone: string | null;
  website: string | null;
  contact_email: string | null;
  distance_m: number | null;
  source: string;
  proposed_at: string;
};

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  google_places: 'Google Places',
  csv: 'CSV',
};

export async function CandidateListTable({ hotelId }: Props): Promise<React.ReactElement> {
  const service = createServiceRoleClient();
  const { data, error } = await service
    .from('candidate_businesses')
    .select(
      'id, name, address, category, phone, website, contact_email, distance_m, source, proposed_at',
    )
    .eq('hotel_id', hotelId)
    .is('removed_at', null)
    .order('proposed_at', { ascending: true });

  if (error) {
    return (
      <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        Could not load the candidate list: {error.message}
      </p>
    );
  }

  const rows = (data ?? []) as CandidateRow[];

  if (rows.length === 0) {
    return (
      <p className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
        No candidates yet. Add businesses with the tools below.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
      {rows.map((row) => (
        <li key={row.id} className="flex items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-neutral-900">{row.name}</div>
            <div className="mt-1 text-xs text-neutral-600">
              {SOURCE_LABEL[row.source] ?? row.source}
              {row.category ? ` · ${row.category}` : ''}
              {row.address ? ` · ${row.address}` : ''}
              {typeof row.distance_m === 'number' ? ` · ${row.distance_m} m away` : ''}
            </div>
            {row.phone || row.website || row.contact_email ? (
              <div className="mt-1 text-xs text-neutral-500">
                {[row.phone, row.website, row.contact_email].filter(Boolean).join(' · ')}
              </div>
            ) : null}
          </div>
          <RemoveCandidateButton hotelId={hotelId} candidateId={row.id} candidateName={row.name} />
        </li>
      ))}
    </ul>
  );
}
