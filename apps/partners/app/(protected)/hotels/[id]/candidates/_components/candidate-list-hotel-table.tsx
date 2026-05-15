import { createServerClient } from '@strictons/db/server';
import { RemoveCandidateButtonHotel } from './remove-candidate-button-hotel';

/**
 * Server Component. Reads the hotel's alive candidate_businesses rows
 * via the cookie-based authenticated client — RLS
 * (candidate_businesses_select_hotel → is_hotel_user) scopes to rows
 * for hotels the caller belongs to. The parent page also enforces
 * `role.hotelId === hotelId`, so the only RLS-permitted rows are this
 * hotel's.
 *
 * `removed_at IS NULL` filters to the alive view. No show-removed
 * toggle in this commit — matches the admin-side pattern from commit 8.
 *
 * Re-renders on revalidatePath('/hotels/[id]/candidates') from the
 * sibling partners Server Actions.
 */
type Props = {
  hotelId: string;
  showRemove: boolean;
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
  google_places: 'From Google',
  csv: 'From spreadsheet',
};

export async function CandidateListHotelTable({
  hotelId,
  showRemove,
}: Props): Promise<React.ReactElement> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
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
        No candidates yet.
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
          {showRemove ? (
            <RemoveCandidateButtonHotel
              hotelId={hotelId}
              candidateId={row.id}
              candidateName={row.name}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
