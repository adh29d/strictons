'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GooglePlaceResultRow, type PlaceSearchResult } from './google-place-result-row';

type Props = {
  hotelId: string;
};

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'results'; results: PlaceSearchResult[] }
  | { kind: 'error'; message: string };

/** Debounce + minimum-length: 300ms / 2 chars (matches GooglePlacesSearchInputSchema). */
const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

/**
 * Google Places search panel. Search-as-you-type: a 300ms debounce
 * fires a POST to the admin-app /api/places/search Route Handler
 * (commit 6) once the trimmed query is at least 2 characters — the
 * same floor GooglePlacesSearchInputSchema enforces server-side. No
 * client-side Google call; the Route Handler is the only thing that
 * talks to Google (and it rate-limits per staff user).
 *
 * Each result renders as a GooglePlaceResultRow with its own
 * add-to-candidate-list form. An AbortController cancels the in-flight
 * request when the query changes again, so a slow earlier response
 * can't overwrite a newer one.
 */
export function GooglePlacesSearchPanel({ hotelId }: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const queryId = useId();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      setState({ kind: 'idle' });
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ kind: 'loading' });

      void fetch('/api/places/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, hotelId }),
        signal: controller.signal,
      })
        .then(async (res) => {
          const body = (await res.json()) as
            | { ok: true; results: PlaceSearchResult[] }
            | { ok: false; error: string };
          if (body.ok) {
            setState({ kind: 'results', results: body.results });
          } else {
            setState({ kind: 'error', message: body.error });
          }
        })
        .catch((cause: unknown) => {
          // An aborted request is expected when the query changes — not
          // an error to surface.
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          setState({ kind: 'error', message: 'Search failed. Please try again.' });
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, hotelId]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={queryId} className="text-sm font-medium">
          Search query
        </label>
        <input
          id={queryId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          placeholder="e.g. coffee near the marina"
          className="rounded border border-neutral-300 px-3 py-2"
        />
        <p className="text-xs text-neutral-500">
          Type at least {MIN_QUERY_LENGTH} characters to search.
        </p>
      </div>

      {state.kind === 'loading' ? <p className="text-sm text-neutral-600">Searching…</p> : null}

      {state.kind === 'error' ? (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {state.message}
        </p>
      ) : null}

      {state.kind === 'results' && state.results.length === 0 ? (
        <p className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
          No matches. Try a different query.
        </p>
      ) : null}

      {state.kind === 'results' && state.results.length > 0 ? (
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
          {state.results.map((result) => (
            <GooglePlaceResultRow key={result.placeId} hotelId={hotelId} result={result} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
