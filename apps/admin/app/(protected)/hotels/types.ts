/**
 * Form state for the hotel CRUD Server Actions.
 *
 * Sibling to actions.ts because that file has 'use server' at the top
 * and may only export async functions. Per Phase 3 gotcha #'use server'
 * export rule.
 *
 * Echoed-back values let the form re-render with what the user typed on
 * a validation failure, so they don't have to retype the whole row.
 * fieldErrors maps field name → message for per-field display under each
 * input; error is the generic top-of-form fallback.
 */
export type HotelFormValues = {
  name?: string;
  slug?: string;
  contact_email?: string;
  approval_state?: string;
  custom_domain?: string | null;
};

export type HotelFormState = {
  ok?: true;
  /** Top-of-form generic error message. */
  error?: string;
  /** Per-field error messages keyed by field name. */
  fieldErrors?: Record<string, string>;
  /** Echo-back of submitted values so the form preserves user input. */
  values?: HotelFormValues;
  /** On successful create, the new hotel's id so the form can link to it. */
  hotelId?: string;
};
