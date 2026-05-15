'use client';

import { useActionState } from 'react';
import { addCandidateFromGooglePlaces } from '../actions';
import type { AddCandidateState } from '../types';

const INITIAL: AddCandidateState = {};

export type PlaceSearchResult = {
  placeId: string;
  name: string;
  formattedAddress?: string;
  primaryType?: string;
};

type Props = {
  hotelId: string;
  result: PlaceSearchResult;
};

/**
 * One Google Places search result with its own Add affordance. Each
 * row gets its own useActionState against addCandidateFromGooglePlaces
 * — the Phase 5 per-row pattern. The Server Action fetches Place
 * Details server-side via the commit-3 adapter; this component never
 * calls Google directly.
 *
 * On success the action's revalidatePath re-renders the
 * CandidateListTable above and the row appears there; this component
 * shows the role="status" confirmation inline. duplicate_place
 * surfaces as state.fieldErrors.placeId.
 */
export function GooglePlaceResultRow({ hotelId, result }: Props): React.ReactElement {
  const [state, formAction, isPending] = useActionState<AddCandidateState, FormData>(
    addCandidateFromGooglePlaces,
    INITIAL,
  );

  const placeIdError = state.fieldErrors?.placeId;

  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-neutral-900">{result.name}</div>
        <div className="mt-1 text-xs text-neutral-600">
          {result.primaryType ? `${result.primaryType}` : ''}
          {result.primaryType && result.formattedAddress ? ' · ' : ''}
          {result.formattedAddress ?? ''}
        </div>
        {placeIdError ? <p className="mt-1 text-xs text-red-700">{placeIdError}</p> : null}
        {state.error && !state.fieldErrors ? (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <p role="status" className="mt-1 text-xs text-green-700">
            {state.message}
          </p>
        ) : null}
      </div>
      <form action={formAction}>
        <input type="hidden" name="hotelId" value={hotelId} />
        <input type="hidden" name="placeId" value={result.placeId} />
        <button
          type="submit"
          disabled={isPending || state.ok === true}
          className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
        >
          {state.ok ? 'Added' : isPending ? 'Adding…' : 'Add'}
        </button>
      </form>
    </li>
  );
}
