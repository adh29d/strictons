'use client';

import { useActionState, useId, useState } from 'react';
import {
  HOTEL_APPROVAL_STATES,
  isLegalTransition,
  type HotelApprovalState,
} from '@strictons/types/hotels';
import { createHotel, updateHotel } from './actions';
import type { HotelFormState } from './types';

const INITIAL: HotelFormState = {};

type CommonProps = {
  /** "Create hotel" or "Save changes" — matches the mode's verb. */
  submitLabel: string;
  /** Pending-state label, e.g. "Creating…" / "Saving…". */
  pendingLabel: string;
};

type CreateProps = CommonProps & {
  mode: 'create';
};

type EditProps = CommonProps & {
  mode: 'edit';
  hotelId: string;
  initial: {
    name: string;
    slug: string;
    contact_email: string;
    approval_state: HotelApprovalState;
    custom_domain: string | null;
  };
};

export type HotelFormProps = CreateProps | EditProps;

/**
 * Shared form for create + edit. Differences:
 *
 *   - Create renders the slug field as editable; edit renders it
 *     read-only (the DB trigger enforces immutability).
 *   - Create binds to createHotel; edit binds to updateHotel and
 *     emits a hidden id field.
 *   - Edit prefills initial values; create starts empty (or with
 *     echo-back values if the previous submission failed validation).
 *
 * Approval-state transition warning
 *
 *   Per Q7 of the approved plan, all transitions are permitted at the
 *   action / DB layer; the form surfaces a NON-BLOCKING warning when
 *   staff picks a transition that isn't in HOTEL_LEGAL_TRANSITIONS.
 *   The warning is informational only — it doesn't disable submit.
 *   Full state-machine enforcement is deferred to Phase 5+ when the
 *   approval-window reminder logic is built.
 */
export function HotelForm(props: HotelFormProps): React.ReactElement {
  const action = props.mode === 'create' ? createHotel : updateHotel;
  const [state, formAction, isPending] = useActionState<HotelFormState, FormData>(action, INITIAL);

  // Local UI state for the transition warning. Tracked separately from
  // the form's submitted value because we want immediate feedback as
  // the user changes the select, not just on submit.
  const initialApprovalState: HotelApprovalState =
    props.mode === 'edit' ? props.initial.approval_state : 'pending_design_meeting';
  const [pendingApprovalState, setPendingApprovalState] =
    useState<HotelApprovalState>(initialApprovalState);

  const showTransitionWarning =
    props.mode === 'edit' && !isLegalTransition(props.initial.approval_state, pendingApprovalState);

  const nameId = useId();
  const slugId = useId();
  const emailId = useId();
  const stateId = useId();
  const domainId = useId();

  // Echo-back precedence: server-side validation echo > initial (edit
  // mode) > empty (create mode).
  const echoed = state.values ?? {};
  const valueFor = (field: keyof typeof echoed, fallback: string | null | undefined): string => {
    const v = echoed[field];
    if (v !== undefined && v !== null) return String(v);
    if (fallback === null || fallback === undefined) return '';
    return fallback;
  };

  const fieldErr = (field: string): string | undefined => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {props.mode === 'edit' ? <input type="hidden" name="id" value={props.hotelId} /> : null}

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
          Saved.
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-sm font-medium">
          Hotel name
        </label>
        <input
          id={nameId}
          name="name"
          type="text"
          required
          defaultValue={valueFor('name', props.mode === 'edit' ? props.initial.name : undefined)}
          className="rounded border border-neutral-300 px-3 py-2"
        />
        {fieldErr('name') ? <p className="text-xs text-red-700">{fieldErr('name')}</p> : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={slugId} className="text-sm font-medium">
          Slug
        </label>
        {props.mode === 'edit' ? (
          <>
            <input
              id={slugId}
              type="text"
              value={props.initial.slug}
              readOnly
              className="rounded border border-neutral-200 bg-neutral-100 px-3 py-2 text-neutral-700"
            />
            <p className="text-xs text-neutral-500">
              Slug is immutable — changing it would break QR codes and mystay.au routing.
            </p>
          </>
        ) : (
          <>
            <input
              id={slugId}
              name="slug"
              type="text"
              required
              defaultValue={valueFor('slug', undefined)}
              pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
              minLength={2}
              maxLength={64}
              placeholder="e.g. beachcomber"
              className="rounded border border-neutral-300 px-3 py-2"
            />
            <p className="text-xs text-neutral-500">
              Lowercase letters, digits, and hyphens. 2–64 characters. Used in URLs and QR codes;
              choose carefully — it cannot be changed.
            </p>
            {fieldErr('slug') ? <p className="text-xs text-red-700">{fieldErr('slug')}</p> : null}
          </>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={emailId} className="text-sm font-medium">
          Contact email
        </label>
        <input
          id={emailId}
          name="contact_email"
          type="email"
          required
          defaultValue={valueFor(
            'contact_email',
            props.mode === 'edit' ? props.initial.contact_email : undefined,
          )}
          autoComplete="off"
          className="rounded border border-neutral-300 px-3 py-2"
        />
        {fieldErr('contact_email') ? (
          <p className="text-xs text-red-700">{fieldErr('contact_email')}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={stateId} className="text-sm font-medium">
          Approval state
        </label>
        <select
          id={stateId}
          name="approval_state"
          required
          defaultValue={valueFor(
            'approval_state',
            props.mode === 'edit' ? props.initial.approval_state : 'pending_design_meeting',
          )}
          onChange={(e) => setPendingApprovalState(e.target.value as HotelApprovalState)}
          className="rounded border border-neutral-300 px-3 py-2"
        >
          {HOTEL_APPROVAL_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {showTransitionWarning ? (
          <p className="text-xs text-amber-700">
            ⚠ This transition isn&apos;t in the documented state machine (
            {props.mode === 'edit' ? props.initial.approval_state : ''} → {pendingApprovalState}).
            You can proceed — the audit log records every change — but double-check this is
            intentional.
          </p>
        ) : null}
        {fieldErr('approval_state') ? (
          <p className="text-xs text-red-700">{fieldErr('approval_state')}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={domainId} className="text-sm font-medium">
          Custom domain
        </label>
        <input
          id={domainId}
          name="custom_domain"
          type="text"
          defaultValue={valueFor(
            'custom_domain',
            props.mode === 'edit' ? props.initial.custom_domain : undefined,
          )}
          placeholder="e.g. guide.beachcomberhotel.com.au"
          className="rounded border border-neutral-300 px-3 py-2"
        />
        <p className="text-xs text-neutral-500">
          Leave blank for the default mystay.au subpath. See the staff runbook for the manual DNS +
          Vercel attachment steps.
        </p>
        {fieldErr('custom_domain') ? (
          <p className="text-xs text-red-700">{fieldErr('custom_domain')}</p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? props.pendingLabel : props.submitLabel}
      </button>
    </form>
  );
}
