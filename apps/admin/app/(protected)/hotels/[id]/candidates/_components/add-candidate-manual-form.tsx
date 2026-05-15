'use client';

import { useActionState, useId } from 'react';
import { addCandidateManualStaff } from '../actions';
import type { AddCandidateState } from '../types';

const INITIAL: AddCandidateState = {};

type Props = {
  hotelId: string;
};

/**
 * Manual candidate-add form. useActionState against
 * addCandidateManualStaff — mirrors the Phase 5 InviteHotelAdminForm
 * shape: uncontrolled inputs, no reset on success, the role="status"
 * message is the deterministic post-action signal.
 *
 * fieldErrors is keyed by the schema field name (name / website /
 * contactEmail / distanceM); each input renders its own error
 * underneath. state.error is the top-of-form summary.
 */
export function AddCandidateManualForm({ hotelId }: Props): React.ReactElement {
  const [state, formAction, isPending] = useActionState<AddCandidateState, FormData>(
    addCandidateManualStaff,
    INITIAL,
  );

  const nameId = useId();
  const addressId = useId();
  const categoryId = useId();
  const phoneId = useId();
  const websiteId = useId();
  const contactEmailId = useId();
  const distanceMId = useId();

  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="hotelId" value={hotelId} />

      {state.error && !state.fieldErrors ? (
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

      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-sm font-medium">
          Business name
        </label>
        <input
          id={nameId}
          name="name"
          type="text"
          required
          autoComplete="off"
          className="rounded border border-neutral-300 px-3 py-2"
        />
        {fe.name ? <p className="text-xs text-red-700">{fe.name}</p> : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={addressId} className="text-sm font-medium">
            Address <span className="text-neutral-400">(optional)</span>
          </label>
          <input
            id={addressId}
            name="address"
            type="text"
            autoComplete="off"
            className="rounded border border-neutral-300 px-3 py-2"
          />
          {fe.address ? <p className="text-xs text-red-700">{fe.address}</p> : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={categoryId} className="text-sm font-medium">
            Category <span className="text-neutral-400">(optional)</span>
          </label>
          <input
            id={categoryId}
            name="category"
            type="text"
            autoComplete="off"
            className="rounded border border-neutral-300 px-3 py-2"
          />
          {fe.category ? <p className="text-xs text-red-700">{fe.category}</p> : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={phoneId} className="text-sm font-medium">
            Phone <span className="text-neutral-400">(optional)</span>
          </label>
          <input
            id={phoneId}
            name="phone"
            type="text"
            autoComplete="off"
            className="rounded border border-neutral-300 px-3 py-2"
          />
          {fe.phone ? <p className="text-xs text-red-700">{fe.phone}</p> : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={websiteId} className="text-sm font-medium">
            Website <span className="text-neutral-400">(optional)</span>
          </label>
          <input
            id={websiteId}
            name="website"
            type="url"
            autoComplete="off"
            placeholder="https://"
            className="rounded border border-neutral-300 px-3 py-2"
          />
          {fe.website ? <p className="text-xs text-red-700">{fe.website}</p> : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={contactEmailId} className="text-sm font-medium">
            Contact email <span className="text-neutral-400">(optional)</span>
          </label>
          <input
            id={contactEmailId}
            name="contactEmail"
            type="email"
            autoComplete="off"
            className="rounded border border-neutral-300 px-3 py-2"
          />
          {fe.contactEmail ? <p className="text-xs text-red-700">{fe.contactEmail}</p> : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={distanceMId} className="text-sm font-medium">
            Distance (metres) <span className="text-neutral-400">(optional)</span>
          </label>
          <input
            id={distanceMId}
            name="distanceM"
            type="number"
            min={0}
            step={1}
            autoComplete="off"
            className="rounded border border-neutral-300 px-3 py-2"
          />
          {fe.distanceM ? <p className="text-xs text-red-700">{fe.distanceM}</p> : null}
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? 'Adding…' : 'Add candidate'}
      </button>
    </form>
  );
}
