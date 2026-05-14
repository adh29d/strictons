import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServiceRoleClient } from '@strictons/db/client';
import type { HotelApprovalState } from '@strictons/types/hotels';
import { AddCandidateManualForm } from './_components/add-candidate-manual-form';
import { GooglePlacesSearchPanel } from './_components/google-places-search-panel';
import { CsvUploadForm } from './_components/csv-upload-form';
import { CandidateListTable } from './_components/candidate-list-table';
import { ListStateControls } from './_components/list-state-controls';

/**
 * Per-hotel candidate-list curation page (Phase 6 commit 8).
 *
 * Server Component. Fetches the hotel row via the service-role client
 * (Phase 2 locked decision — Strictons-staff reads route through
 * service-role too). force-dynamic mirrors /hotels/[id] so the
 * Server Components re-render on the revalidatePath('/hotels/[id]/
 * candidates') the candidate Server Actions fire.
 *
 * hotels.approval_state is the source of truth for the list lifecycle
 * (§0.1 / commit 1) — it's shown prominently here and gates the
 * mark-ready / reopen controls. The three add affordances (manual,
 * Google Places, CSV) have no list-state precondition (§3.1) so they
 * are always available to staff.
 *
 * Removed candidates are filtered out of the view (CandidateListTable
 * applies `removed_at IS NULL`); there is no show-removed toggle in
 * this commit — the §4 RemovedCandidatesPanel is deferred.
 */

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

/** Human-readable label for the candidate-list-relevant approval states. */
const APPROVAL_STATE_LABEL: Partial<Record<HotelApprovalState, string>> = {
  pending_design_meeting: 'Pending design meeting',
  design_meeting_held: 'Design meeting held',
  candidate_list_drafted: 'Draft — staff building the list',
  candidate_list_with_hotel: 'With hotel for review',
  candidate_list_approved: 'Approved by hotel',
  paused_awaiting_hotel_response: 'Paused — awaiting hotel response',
};

function approvalStateLabel(state: HotelApprovalState): string {
  return APPROVAL_STATE_LABEL[state] ?? state.replace(/_/g, ' ');
}

export default async function HotelCandidatesPage({
  params,
}: {
  params: Params;
}): Promise<React.ReactElement> {
  const { id } = await params;

  const service = createServiceRoleClient();
  const { data: hotel, error } = await service
    .from('hotels')
    .select('id, name, slug, approval_state, candidate_list_approval_due_at')
    .eq('id', id)
    .maybeSingle();

  if (error || !hotel) {
    notFound();
  }

  const approvalState = hotel.approval_state as HotelApprovalState;
  const dueAt = hotel.candidate_list_approval_due_at;

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-6">
        <Link href={`/hotels/${hotel.id}`} className="text-sm text-neutral-600 underline">
          ← {hotel.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Candidate list</h1>
        <p className="mt-1 text-xs text-neutral-600">
          <code>{hotel.slug}</code>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-800">
            List status: {approvalStateLabel(approvalState)}
          </span>
          {approvalState === 'candidate_list_with_hotel' && dueAt ? (
            <span className="text-xs text-neutral-600">
              Hotel review due by {dueAt.slice(0, 10)}
            </span>
          ) : null}
        </div>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">Current candidates</h2>
        <CandidateListTable hotelId={hotel.id} />
      </section>

      <section className="mb-10 border-t border-neutral-200 pt-8">
        <h2 className="mb-3 text-lg font-semibold">List status</h2>
        <ListStateControls hotelId={hotel.id} approvalState={approvalState} />
      </section>

      <section className="mb-10 border-t border-neutral-200 pt-8">
        <h2 className="mb-1 text-lg font-semibold">Add a candidate manually</h2>
        <p className="mb-4 text-sm text-neutral-600">
          For businesses the Google Places search and CSV upload don&apos;t cover.
        </p>
        <AddCandidateManualForm hotelId={hotel.id} />
      </section>

      <section className="mb-10 border-t border-neutral-200 pt-8">
        <h2 className="mb-1 text-lg font-semibold">Search Google Places</h2>
        <p className="mb-4 text-sm text-neutral-600">
          Search by name or area, then add a result to this hotel&apos;s candidate list.
        </p>
        <GooglePlacesSearchPanel hotelId={hotel.id} />
      </section>

      <section className="border-t border-neutral-200 pt-8">
        <h2 className="mb-1 text-lg font-semibold">Bulk upload from CSV</h2>
        <p className="mb-4 text-sm text-neutral-600">
          Upload a prepared spreadsheet (max 1 MB, 500 rows).{' '}
          <a href="/candidate-template.csv" download className="underline">
            Download the template
          </a>{' '}
          for the column headers.
        </p>
        <CsvUploadForm hotelId={hotel.id} />
      </section>
    </main>
  );
}
