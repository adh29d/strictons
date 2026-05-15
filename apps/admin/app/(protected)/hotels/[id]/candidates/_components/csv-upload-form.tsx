'use client';

import { useActionState, useId } from 'react';
import { uploadCandidateCsv } from '../actions';
import type { UploadCsvState } from '../types';

const INITIAL: UploadCsvState = {};

type Props = {
  hotelId: string;
};

/**
 * CSV bulk-upload form. useActionState against uploadCandidateCsv —
 * the FormData carries the hotelId (hidden) and the File. The action
 * parses server-side via the commit-4 parser; this component renders
 * the import summary (imported / rejected counts) and the per-row
 * rejection list from the returned state.
 *
 * `rejected` is present on both an ok:true partial result and an
 * ok:false INSERT-batch failure, so the rejection list renders
 * whenever it's non-empty regardless of ok.
 */
export function CsvUploadForm({ hotelId }: Props): React.ReactElement {
  const [state, formAction, isPending] = useActionState<UploadCsvState, FormData>(
    uploadCandidateCsv,
    INITIAL,
  );

  const fileId = useId();
  const rejected = state.rejected ?? [];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="hotelId" value={hotelId} />

      <div className="flex flex-col gap-1">
        <label htmlFor={fileId} className="text-sm font-medium">
          CSV file
        </label>
        <input
          id={fileId}
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? 'Uploading…' : 'Upload CSV'}
      </button>

      {state.error ? (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {state.error}
        </p>
      ) : null}

      {state.ok ? (
        <p
          role="status"
          className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800"
        >
          {state.message}
        </p>
      ) : null}

      {rejected.length > 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            {rejected.length} row{rejected.length === 1 ? '' : 's'} skipped:
          </p>
          <ul className="mt-2 list-inside list-disc text-xs text-amber-800">
            {rejected.map((r) => (
              <li key={r.rowNumber}>
                Row {r.rowNumber}: {r.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
