import { z } from 'zod';

/**
 * Schemas for the Phase 6 candidate-list curation flows.
 *
 * Consumed by the admin-app and partners-app Server Actions and the
 * admin-app Google Places Route Handler (PHASE_6_PLAN.md §3). Following
 * the Phase 5 locked decision, input schemas live here in
 * `@strictons/types`; per-consumer state shapes (AddCandidateState,
 * UploadCsvState, etc.) live local to each app alongside its actions.ts.
 *
 * Source-of-truth mirroring
 *
 *   CANDIDATE_SOURCES mirrors the `public.candidate_source` enum and
 *   CANDIDATE_STATUSES mirrors `public.candidate_status` — both from
 *   migration 20260504100000_baseline.sql, with `removed_by_strictons`
 *   appended by migration 20260513100000_candidate_businesses_phase6.sql
 *   (Q3). The arrays are restated here because zod.enum and runtime
 *   consumers need a literal array; the generated DB types expose the
 *   enums as TS unions only. The CANDIDATE_STATUSES order matches
 *   `pg_enum.enumsortorder` — `removed_by_strictons` lands last because
 *   `alter type ... add value` without BEFORE/AFTER appends at the end.
 *   Consumers that need compile-time exhaustiveness assert against
 *   `Database['public']['Enums'][...]` per the Phase 4 pattern.
 *
 * CSV column contract
 *
 *   CsvRowSchema field names are snake_case because they ARE the CSV
 *   column-header contract (PHASE_6_PLAN.md §7.2) — the parser
 *   lowercases + trims headers before validation, so the schema keys
 *   are the post-normalisation header names. The other schemas use
 *   camelCase because they describe FormData / JSON request payloads,
 *   not spreadsheet columns.
 */

// ----------------------------------------------------------------------------
// Enums (literal-array mirrors of the DB enums)
// ----------------------------------------------------------------------------

export const CANDIDATE_SOURCES = ['google_places', 'csv', 'manual'] as const;
export const CANDIDATE_STATUSES = [
  'proposed',
  'approved',
  'removed_by_hotel',
  'signed_to_placement',
  'removed_by_strictons',
] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

// ----------------------------------------------------------------------------
// Manual add (staff-side and hotel-side share the input schema)
// ----------------------------------------------------------------------------

export const ManualCandidateInputSchema = z.object({
  hotelId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).optional().nullable(),
  category: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(60).optional().nullable(),
  website: z.string().trim().url().max(500).optional().nullable(),
  contactEmail: z.email().max(254).optional().nullable(),
  distanceM: z.number().int().nonnegative().max(50_000).optional().nullable(),
});
export type ManualCandidateInput = z.infer<typeof ManualCandidateInputSchema>;

// ----------------------------------------------------------------------------
// Google Places search + add (admin-app / staff-only)
// ----------------------------------------------------------------------------

export const GooglePlacesSearchInputSchema = z.object({
  query: z.string().trim().min(2).max(200),
  hotelId: z.uuid(),
});
export type GooglePlacesSearchInput = z.infer<typeof GooglePlacesSearchInputSchema>;

export const AddFromGooglePlacesInputSchema = z.object({
  hotelId: z.uuid(),
  placeId: z.string().trim().min(1).max(255),
  // Optional category override; if absent, derived from Place primaryType.
  category: z.string().trim().max(120).optional().nullable(),
});
export type AddFromGooglePlacesInput = z.infer<typeof AddFromGooglePlacesInputSchema>;

// ----------------------------------------------------------------------------
// CSV upload (admin-app / staff-only)
// ----------------------------------------------------------------------------

// Per-row shape after parse. Header names below are the column contract.
// Bytes < 1 MB and rows <= 500 are enforced in the Server Action, not schema.
export const CsvRowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).optional().nullable(),
  category: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(60).optional().nullable(),
  website: z.string().trim().url().max(500).optional().nullable(),
  contact_email: z.email().max(254).optional().nullable(),
  distance_m: z.coerce.number().int().nonnegative().max(50_000).optional().nullable(),
});
export type CsvRow = z.infer<typeof CsvRowSchema>;

/**
 * FormData input for the uploadCandidateCsv Server Action. The CSV file
 * itself is a File/Blob and cannot be zod-validated — it goes through
 * parseCandidatesCsv (apps/admin/lib/parse-candidates-csv). This schema
 * covers the only zod-validatable part of the FormData: the hotel id.
 * Completes the one-schema-per-action pattern the other admin actions
 * follow.
 */
export const CsvUploadInputSchema = z.object({
  hotelId: z.uuid(),
});
export type CsvUploadInput = z.infer<typeof CsvUploadInputSchema>;

// ----------------------------------------------------------------------------
// Remove (soft-delete)
// ----------------------------------------------------------------------------

export const RemoveCandidateInputSchema = z.object({
  hotelId: z.uuid(),
  candidateId: z.uuid(),
  reason: z.string().trim().max(500).optional().nullable(),
});
export type RemoveCandidateInput = z.infer<typeof RemoveCandidateInputSchema>;

// ----------------------------------------------------------------------------
// List-level state transitions
// ----------------------------------------------------------------------------

export const MarkListReadyForReviewInputSchema = z.object({ hotelId: z.uuid() });
export type MarkListReadyForReviewInput = z.infer<typeof MarkListReadyForReviewInputSchema>;

export const ApproveCandidateListInputSchema = z.object({ hotelId: z.uuid() });
export type ApproveCandidateListInput = z.infer<typeof ApproveCandidateListInputSchema>;

export const ReopenCandidateListInputSchema = z.object({
  hotelId: z.uuid(),
  // Staff reopens to either drafted (heavy edit needed) or with_hotel (just
  // un-approve). Both transitions are audit-logged with the same action.
  targetState: z.enum(['candidate_list_drafted', 'candidate_list_with_hotel']),
  // Optional free-text reason (Q4). Surfaces in the audit log's `after`
  // payload only; no UI listing of past reasons in Phase 6 (audit-log
  // visibility is the read surface).
  reason: z.string().trim().max(500).optional().nullable(),
});
export type ReopenCandidateListInput = z.infer<typeof ReopenCandidateListInputSchema>;
