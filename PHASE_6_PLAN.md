# Phase 6 plan — Candidate-list curation

Plan-only artefact for review. No code in this round.

---

## 0. Up-front pushback

Two structural notes on the locked scope before the plan proper:

### 0.1 List-approval state — the existing `hotels.approval_state` enum already encodes it

The locked decision item 6 says "the exact state column placement (on `hotels`, on a new `candidate_lists` row, or inline) is YOUR design call." After re-reading `20260504100000_baseline.sql` lines 33-83 and `20260504100200_hotels.sql` lines 18-24, my call is **none of those three** — the existing `hotels.approval_state` enum and its associated due-date columns already model exactly this lifecycle:

| Phase 6 lifecycle name | Existing `hotel_approval_state` value |
|---|---|
| `building` (staff researching) | `candidate_list_drafted` |
| `ready_for_review` (hotel can see + edit) | `candidate_list_with_hotel` |
| `approved` (hotel locked in) | `candidate_list_approved` |

Plus `paused_awaiting_hotel_response` already covers the 14-day no-response case (baseline lines 44-48). The transition `candidate_list_drafted → candidate_list_with_hotel` is documented as "sets `candidate_list_approval_due_at = now() + 14 days`" — exactly the staff "mark ready for review" action. The transition `candidate_list_with_hotel → candidate_list_approved` is documented as "hotel_admin action via portal" — exactly the hotel approve action. Baseline line 70 spells out the design-meeting-held → candidate_list_drafted entry edge.

**Recommendation: do not add a new column or table for list state.** Wire the existing enum and existing due-date columns. The Phase 6 work becomes "implement the transitions that were always planned to live here", not "design a parallel state-tracking surface." This is asked formally as Q1 because the prompt called it out, but if you agree, the answer locks in and the rest of the plan assumes it.

If you disagree, the alternative shape is a new `hotels.candidate_list_state public.candidate_list_state` column plus enum — but it would duplicate the existing semantics with no extra signal, and would force two-column writes on every transition to keep them in sync.

### 0.2 Hotel-admin manual-add overlaps the existing UPDATE-policy semantics; INSERT policy needs adding

The current `candidate_businesses_insert_strictons` policy (migration 5 lines 64-66) restricts INSERT to Strictons staff. Locked decision item 2 ("hotel-side surface: full read + manual add + remove + approve") requires extending INSERT to hotel admins for `source='manual'`. This is a real RLS-policy addition, not a service-role-bypass — hotels add rows via their own authenticated session per the Phase 2 locked decision (no service-role from partners app for hotel-scoped writes). Detail in §3 below.

No pushback on items 1, 3, 4, 5, or 7. Item 6's framing answer is "use the existing enum" per §0.1.

---

## 1. Schema changes

One migration appended to the existing `candidate_businesses` table. No new tables.

### Migration: `20260513100000_candidate_businesses_phase6.sql`

**Type:** append to existing `candidate_businesses` table. No new enum types, no new tables.

**Shape (rough SQL):**

```sql
-- 1. Soft-delete shape (locked decision 5)
alter table public.candidate_businesses
  add column removed_at timestamptz,
  add column removed_by uuid references public.users(id) on delete set null,
  add column removal_reason text;

-- removed_at and removed_by move together
alter table public.candidate_businesses
  add constraint candidate_businesses_removed_pair_check
  check (
    (removed_at is null and removed_by is null)
    or (removed_at is not null and removed_by is not null)
  );

-- 2. Inline identifying-data fields the "only on signing" model requires.
--    candidate_businesses must carry enough to contact a business without
--    promoting it to a `businesses` row (locked decision 1).
alter table public.candidate_businesses
  add column phone text,
  add column website text,
  add column contact_email citext,
  add column proposed_by uuid references public.users(id) on delete set null;

-- 3. Indexes
-- Partial unique to prevent re-adding the same Google place to the same
-- hotel's list while it's still "live" (alive = not removed, not signed).
create unique index candidate_businesses_hotel_place_alive_uidx
  on public.candidate_businesses (hotel_id, google_place_id)
  where google_place_id is not null
    and removed_at is null
    and status <> 'signed_to_placement';

-- Hotel-scoped "alive list" reads are the dominant access pattern.
create index candidate_businesses_hotel_alive_idx
  on public.candidate_businesses (hotel_id)
  where removed_at is null;

-- 4. INSERT policy: hotel admin can add manual candidates
--    (extends locked decision 2; new policy alongside the existing
--    candidate_businesses_insert_strictons).
create policy "candidate_businesses_insert_hotel_admin_manual"
  on public.candidate_businesses for insert to authenticated
  with check (
    public.is_hotel_admin(hotel_id)
    and source = 'manual'
    and proposed_by = auth.uid()
    and removed_at is null
    and status = 'proposed'
    and linked_business_id is null
  );

-- INSERT column GRANTs for authenticated:
--   The existing migration 5 has no per-column INSERT GRANT for
--   authenticated (the policy was Strictons-only). We add columns
--   explicitly; the policy's with-check enforces shape.
grant insert (
  hotel_id, source, name, address, category, distance_m,
  phone, website, contact_email, proposed_by, status
) on public.candidate_businesses to authenticated;

-- 5. Extend the existing hotel-admin UPDATE column GRANT to cover soft-delete.
grant update (removed_at, removed_by, removal_reason, status)
  on public.candidate_businesses to authenticated;

-- 6. The existing candidate_businesses_update_hotel_admin policy already
--    requires public.is_hotel_admin(hotel_id) for both USING and WITH CHECK.
--    We need to allow the soft-delete path. Drop and recreate with the
--    refined predicate:
drop policy "candidate_businesses_update_hotel_admin" on public.candidate_businesses;

create policy "candidate_businesses_update_hotel_admin"
  on public.candidate_businesses for update to authenticated
  using (public.is_hotel_admin(hotel_id))
  with check (
    public.is_hotel_admin(hotel_id)
    -- Hotel admin can ONLY soft-delete (status -> 'removed_by_hotel'
    -- paired with removed_at/removed_by). The Phase 6 list-level approve
    -- happens by UPDATEing hotels.approval_state, not by mutating
    -- per-candidate-row status. Per-row 'approved' is removed from the
    -- allowed transitions because list-level approval supersedes it (see
    -- §0.1).
    and status = 'removed_by_hotel'
    and removed_at is not null
    and removed_by = auth.uid()
  );

-- 7. Hotel-admin UPDATE on hotels.approval_state for the approve action.
--    Migration 2's grant currently only allows hotel_admin to update
--    contact_email. Phase 6 extends to allow the approve transition.
grant update (approval_state, candidate_list_approved_at)
  on public.hotels to authenticated;

-- Add a policy for the specific transition; the existing
-- hotels_update_admin_contact_email policy continues to cover contact_email.
create policy "hotels_update_admin_approve_candidate_list"
  on public.hotels for update to authenticated
  using (
    public.is_hotel_admin(id)
    and approval_state = 'candidate_list_with_hotel'
  )
  with check (
    public.is_hotel_admin(id)
    and approval_state = 'candidate_list_approved'
    and candidate_list_approved_at is not null
  );

-- All other approval_state transitions (mark-ready-for-review, reopen,
-- paused_awaiting_hotel_response, businesses_pitching, etc.) remain
-- Strictons-only via service-role per Phase 2's locked decision.

comment on column public.candidate_businesses.removed_at is
  'Soft-delete timestamp. removed_at + removed_by are the canonical "alive" filter, and the column template the deferred hotels/businesses soft-delete work will reuse.';
comment on column public.candidate_businesses.removed_by is
  'User who soft-deleted the row. Pair with removed_at.';
```

**Notes on shape decisions:**

- `removed_at` + `removed_by` + optional `removal_reason` matches locked decision 5 and is the template for the deferred soft-delete work on `hotels` and `businesses`. `removal_reason` is `text`, not enum — both because the use case is free-form context ("hotel said this place closed", "duplicate of …"), and because committing to an enum now would force a Phase 7+ migration the first time staff want a value not on the list.
- The CHECK pairs `removed_at` and `removed_by`. Soft-delete is a paired operation; the schema enforces it. `removal_reason` is independent — optional.
- `proposed_by` is new. The existing schema has `decided_by_user_id` (who approved/removed) but no symmetric "who added it." Phase 6 needs this to attribute hotel-manual-add rows to the hotel admin in the UI and the audit trail; it also captures the Strictons staff user on staff adds.
- `phone`, `website`, `contact_email` cover the "candidate carries identifying data inline" half of locked decision 1. Social handles are deferred — they're a `businesses`-row concept per migration 4 and aren't needed until signing.
- The partial unique index on `(hotel_id, google_place_id)` filtered to alive + not-signed rows prevents the most likely staff mistake (re-adding the same Google place); doesn't block legitimate re-adds after removal (the original row's `removed_at` excludes it from the index).
- Per §0.1, the existing per-row `status='approved'` value is removed from the allowed hotel-admin UPDATE transitions. The enum value still exists, but no hotel-side surface emits it and no Phase 6 code path uses it. We don't migrate it out (locked decision: append-only on enums); it stays as a vestigial value with a comment.

### Type generation

After the migration applies (locally first, in CI), `pnpm --filter @strictons/db gen:types` regenerates `packages/db/src/database.types.ts`. The new columns appear on the `candidate_businesses` Row/Insert/Update types automatically.

No new types in `@strictons/types` for DB enums (we already reference the DB-generated literal arrays via the Phase 4 exhaustiveness-check pattern in admin's actions). New schemas land at the new subpath below.

---

## 2. `@strictons/types/candidates` (new subpath)

Following Phase 5's locked decision (input schemas live in `@strictons/types`, state shapes local to the consumer), this new subpath carries all Phase 6 zod schemas. Add `./candidates` to `packages/types/package.json` exports.

```ts
// packages/types/src/candidates.ts

import { z } from 'zod';

// Mirror DB enums for literal-array exhaustiveness checks in consumers.
export const CANDIDATE_SOURCES = ['google_places', 'csv', 'manual'] as const;
export const CANDIDATE_STATUSES = [
  'proposed', 'approved', 'removed_by_hotel', 'signed_to_placement',
] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

// --- Manual add (staff-side and hotel-side share the input schema) ---
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

// --- Google Places search + add ---
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

// --- CSV upload ---
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

// --- Remove (soft-delete) ---
export const RemoveCandidateInputSchema = z.object({
  hotelId: z.uuid(),
  candidateId: z.uuid(),
  reason: z.string().trim().max(500).optional().nullable(),
});
export type RemoveCandidateInput = z.infer<typeof RemoveCandidateInputSchema>;

// --- List-level state transitions ---
export const MarkListReadyForReviewInputSchema = z.object({ hotelId: z.uuid() });
export const ApproveCandidateListInputSchema = z.object({ hotelId: z.uuid() });
export const ReopenCandidateListInputSchema = z.object({
  hotelId: z.uuid(),
  // Staff reopens to either drafted (heavy edit needed) or with_hotel (just
  // un-approve). Both transitions are audit-logged with the same action.
  targetState: z.enum(['candidate_list_drafted', 'candidate_list_with_hotel']),
});
export type ReopenCandidateListInput = z.infer<typeof ReopenCandidateListInputSchema>;
```

Test file `packages/types/src/candidates.test.ts` exercises positive + negative cases for each schema (mirroring the `hotels.test.ts` pattern from Phase 4).

State-shape types (`AddCandidateState`, `RemoveCandidateState`, `UploadCsvState` with per-row error list, `ApproveListState`, etc.) live in the consuming apps' local `types.ts` files alongside their `actions.ts`.

---

## 3. Server Actions and Route Handlers — full contracts

The contracts below are what I'll hold myself to. Any contract extension during implementation must surface as a question first per Phase 5's lesson.

### 3.1 Admin app — `apps/admin/app/(protected)/hotels/[id]/candidates/`

All actions: gated by `requireStaff()` (admin-lib helper from Phase 5); wrapped in `withServerActionInstrumentation`; service-role client used for the actual write (Phase 2 locked decision: no FOR ALL is_strictons_staff() policies on candidate_businesses); audit-logged on every outcome (success and per-reason failure); revalidate the literal route `/hotels/[id]` (and a new `/hotels/[id]/candidates` route if we use one; see §4).

#### Action: `addCandidateManualStaff(prev, formData) → AddCandidateState`

| Input | `FormData` containing `hotelId`, `name`, `address?`, `category?`, `phone?`, `website?`, `contactEmail?`, `distanceM?` |
| Validates | `ManualCandidateInputSchema` |
| Insert shape | `{ hotel_id, source: 'manual', name, address, category, distance_m, phone, website, contact_email, proposed_by: staffUserId, status: 'proposed' }` |
| Returns success | `{ ok: true, message: 'Candidate added.', candidateId }` |
| Returns failure | `{ ok: false, error: string, fieldErrors?: Record<string, string> }` |
| Audit (success) | `action='candidate_added', actor_role='strictons_staff', entity_type='candidate_businesses', entity_id=<new row id>, entity_hotel_id=<hotelId>, after={ source: 'manual', name }` |
| Audit (failure) | `action='candidate_add_failed', after={ reason: 'hotel_not_found'\|'validation_failed'\|'insert_failed', message }` |

#### Action: `addCandidateFromGooglePlaces(prev, formData) → AddCandidateState`

| Input | `FormData` containing `hotelId`, `placeId`, `category?` (override) |
| Validates | `AddFromGooglePlacesInputSchema` |
| External call | Place Details fetch via the adapter in §5 (server-side, the action calls it directly — no Route Handler hop). |
| Insert shape | `{ hotel_id, source: 'google_places', google_place_id: placeId, name, address, category, distance_m, phone, website, proposed_by: staffUserId, status: 'proposed' }` populated from the Place Details response. |
| Returns success | `{ ok: true, message: 'Candidate added.', candidateId }` |
| Returns failure | Same shape as manual; additional `reason` values `place_not_found`, `places_api_failed`, `duplicate_place` (Postgres 23505 from the partial unique index — surfaces as a field error pointing at the existing row). |
| Audit | Same `candidate_added` action with `after.source='google_places'`, `after.google_place_id`. Failure rows include `reason` discriminator. |

#### Action: `uploadCandidateCsv(prev, formData) → UploadCsvState`

| Input | `FormData` with `hotelId` and `file` (the CSV); file size <= 1 MB; row count <= 500 (post-parse) |
| Parses | `papaparse` (new dep — see §5.3) with `header: true`; expected headers: `name, address, category, phone, website, contact_email, distance_m`; missing optional columns OK; missing `name` column is a fatal parse error before per-row work. |
| Per-row validation | Each row through `CsvRowSchema.safeParse`. Successful rows accumulated as INSERT payloads; failed rows accumulated as `{ rowNumber, error: string }`. |
| Insert | Single `service.from('candidate_businesses').insert([...validRows])`. Source is `'csv'` for every row; `proposed_by=staffUserId` for every row. Partial-insert semantics: if the whole INSERT fails, no rows land; if it succeeds, all valid rows land. (No per-row best-effort insert — too fiddly for the win.) |
| Returns success (full) | `{ ok: true, message: 'Imported {N} candidates.', importedCount: N, rejectedCount: 0, rejected: [] }` |
| Returns success (partial validation failure but insert OK) | `{ ok: true, message: 'Imported {N} candidates; {M} rows had errors and were skipped.', importedCount: N, rejectedCount: M, rejected: [{ rowNumber, error }] }` |
| Returns failure | `{ ok: false, error, rejected: [...] }` — covers oversized file, > 500 rows, malformed CSV (missing `name` column, etc.), or INSERT-batch failure. |
| Audit (success) | `candidate_csv_imported` with `after={ imported: N, rejected: M }`. Per-row rejection details NOT in audit (would balloon the audit row); they go in the action's return state and the UI shows them. |
| Audit (failure) | `candidate_csv_import_failed` with `after={ reason, message }`. |

#### Action: `removeCandidateAsStaff(prev, formData) → RemoveCandidateState`

| Input | `FormData` with `hotelId`, `candidateId`, optional `reason` |
| Validates | `RemoveCandidateInputSchema` |
| Update shape | Service-role UPDATE: `{ removed_at: now(), removed_by: staffUserId, removal_reason: reason ?? null, status: 'removed_by_hotel' /* see note */ }` |

*Note on `status` for staff-side removal:* the existing enum has `removed_by_hotel` only. For consistency with the soft-delete model, staff-side removals also set `status='removed_by_hotel'` — the canonical "is removed" signal is `removed_at`, not `status`. We do NOT add a `removed_by_strictons` enum value (locked decision: append-only on enums; the `removed_by` column captures the actor). Open as Q3 because it's the kind of small overload worth confirming.

| Returns success | `{ ok: true, message: 'Candidate removed.' }` |
| Audit | `candidate_removed`, `actor_role='strictons_staff'`, `after={ reason, removed_at }` |

#### Action: `markCandidateListReadyForReview(prev, formData) → MarkReadyState`

| Input | `FormData` with `hotelId` |
| Validates | `MarkListReadyForReviewInputSchema` |
| Preconditions | `hotels.approval_state` must be `candidate_list_drafted`. Otherwise return `{ ok: false, error: 'List is not in the drafted state.' }` |
| Update shape | Service-role UPDATE on `hotels`: `{ approval_state: 'candidate_list_with_hotel', candidate_list_approval_due_at: now() + interval '14 days' }` |
| Returns success | `{ ok: true, message: 'List ready for hotel review.' }` |
| Audit | `candidate_list_marked_ready_for_review`, `entity_type='hotels'`, `entity_id=<hotelId>`, `entity_hotel_id=<hotelId>`, `after={ candidate_list_approval_due_at }` |

#### Action: `reopenCandidateList(prev, formData) → ReopenState`

| Input | `FormData` with `hotelId`, `targetState` (`candidate_list_drafted` or `candidate_list_with_hotel`) |
| Validates | `ReopenCandidateListInputSchema` |
| Preconditions | `hotels.approval_state` must be `candidate_list_approved` OR `candidate_list_with_hotel` (the latter is "un-mark-ready"). Reject other states. |
| Update shape | Service-role UPDATE on `hotels`: `{ approval_state: targetState, candidate_list_approved_at: null }`. If targetState is `candidate_list_drafted`, also clears `candidate_list_approval_due_at`; if it is `candidate_list_with_hotel`, leaves the existing due_at alone OR resets to `now() + 14 days` (recommend: leaves the existing — staff is correcting course, not restarting the clock). |
| Returns success | `{ ok: true, message: 'List reopened.' }` |
| Audit | `candidate_list_reopened`, `actor_role='strictons_staff'`, `after={ from_state, to_state, reason? }` — `reason` deferred (no UI for it Phase 6; Q4) |

### 3.2 Route Handler — admin app — `apps/admin/app/api/places/search/route.ts`

`POST /api/places/search` (admin-only; staff session required; rate-limited).

| Auth gate | `requireStaff()` against the cookie-based server client (this is a Route Handler, not a Server Action — uses the partners-style `createServerClient` pattern from `@strictons/db/server`). If not staff → 401. |
| Request body | `{ query: string, hotelId: string }` validated with `GooglePlacesSearchInputSchema`. The `hotelId` is recorded in audit; it doesn't gate the search (any staff can search). |
| External call | Google Places Text Search via the adapter in §5. |
| Response success | `{ ok: true, results: Array<{ placeId, name, formattedAddress, primaryType?, location? }> }`. Capped at top 10 results. |
| Response failure | `{ ok: false, error: string }` with HTTP 400 (validation), 401 (unauth), 429 (rate-limit), 502 (upstream Google failure) status codes. |
| Rate limit | Per staff user, in-memory token bucket: 30 requests / 60 s. On overflow → 429 with `Retry-After` header. The bucket lives on `globalThis` keyed by `Symbol.for('@strictons/admin/places-rate-limit')` to survive the module-instance-split issue. Phase 6 only; persistent rate limiting deferred. |
| Audit | NOT every search (would balloon audit). Audit only on the `addCandidateFromGooglePlaces` Server Action when a place is actually added. Searches are observable via Sentry transactions + Google's own console. |

No corresponding details Route Handler — `addCandidateFromGooglePlaces` fetches details directly inside the Server Action (single round-trip needed at add time; no client interactivity).

### 3.3 Partners app — `apps/partners/app/(protected)/hotels/[id]/candidates/`

All actions: cookie-based authenticated client (NOT service-role); RLS is the access boundary; audit-logged via service-role helper (audit_log INSERT is service-role only). Audit actions use `actor_role='hotel_admin'`.

#### Action: `addCandidateManualHotel(prev, formData) → AddCandidateState`

| Input | Same FormData shape as the staff-side manual add |
| Validates | `ManualCandidateInputSchema` |
| Preconditions | The hotel's `approval_state` must be `candidate_list_with_hotel` OR `paused_awaiting_hotel_response`. Hotels can't add during `candidate_list_drafted` (staff still building) or `candidate_list_approved` (locked). Returns `{ ok: false, error }` otherwise. |
| Insert | Authenticated client INSERT (RLS-permitted by the new `candidate_businesses_insert_hotel_admin_manual` policy). Shape: `{ hotel_id, source: 'manual', name, address, category, distance_m, phone, website, contact_email, proposed_by: auth.uid(), status: 'proposed' }` |
| Returns | Same success/failure shape as staff-side manual add |
| Audit | `candidate_added`, `actor_role='hotel_admin'`, `after={ source: 'manual', name, proposed_by_hotel: true }`. Written via service-role audit helper. |

#### Action: `removeCandidateAsHotel(prev, formData) → RemoveCandidateState`

| Input | `FormData` with `hotelId`, `candidateId`, optional `reason` |
| Validates | `RemoveCandidateInputSchema` |
| Preconditions | Same as add — list must be in `candidate_list_with_hotel` or `paused_awaiting_hotel_response`. |
| Update | Authenticated client UPDATE (RLS-permitted by the refined `candidate_businesses_update_hotel_admin` policy): `{ status: 'removed_by_hotel', removed_at: now(), removed_by: auth.uid(), removal_reason: reason ?? null }` |
| Returns | Same shape as staff-side remove |
| Audit | `candidate_removed`, `actor_role='hotel_admin'` |

#### Action: `approveCandidateList(prev, formData) → ApproveListState`

| Input | `FormData` with `hotelId` |
| Validates | `ApproveCandidateListInputSchema` |
| Preconditions | `hotels.approval_state === 'candidate_list_with_hotel'`. Reject otherwise (one-way for hotel — they can't approve from any other state; staff reopen is the only way back). |
| Update | Authenticated client UPDATE on `hotels` (RLS-permitted by the new `hotels_update_admin_approve_candidate_list` policy): `{ approval_state: 'candidate_list_approved', candidate_list_approved_at: now() }` |
| Returns | `{ ok: true, message: 'Candidate list approved.' }` |
| Audit | `candidate_list_approved`, `actor_role='hotel_admin'`, `entity_type='hotels'`, `entity_id=<hotelId>`, `entity_hotel_id=<hotelId>`, `after={ approved_at }` |

---

## 4. Admin-app UI surfaces

Routes anchored under `apps/admin/app/(protected)/hotels/[id]/candidates/`:

- `page.tsx` — server component, lists all candidates (alive + removed-toggle). Renders three add affordances (manual, Google Places search, CSV upload) and the list-state controls (mark-ready, reopen) gated by current `hotels.approval_state`.
- `_components/AddCandidateManualForm.tsx` — client component, mirrors `InviteHotelAdminForm`'s `useActionState` shape.
- `_components/GooglePlacesSearchPanel.tsx` — client component. Search input → POSTs `/api/places/search` → renders top-10 results → each result has an "Add" button that submits to the `addCandidateFromGooglePlaces` Server Action. No client-side Google calls.
- `_components/CsvUploadForm.tsx` — client component. `<input type="file" accept=".csv,text/csv" />` submitted via Server Action. Renders per-row error list and import-count summary from action state.
- `_components/CandidateListTable.tsx` — server component, renders alive rows with per-row "Remove" affordance (Strictons-staff remove form).
- `_components/RemovedCandidatesPanel.tsx` — server component, collapsible "Show {N} removed" — staff visibility into deletions.
- `_components/ListStateControls.tsx` — client component, conditionally renders:
  - `candidate_list_drafted` → "Mark ready for hotel review" button (form → `markCandidateListReadyForReview`)
  - `candidate_list_with_hotel` → "Reopen for editing" button + "Hotel review in progress" status text
  - `candidate_list_approved` → "Reopen" button (form → `reopenCandidateList`, defaults to `candidate_list_drafted` target via a select)

No surface for "approve" on admin side — that's hotel-only.

Existing `apps/admin/app/(protected)/hotels/[id]/page.tsx` gets a top-level link "Candidate list" pointing at the new sub-route.

---

## 5. Partners-app UI surfaces

Routes anchored under `apps/partners/app/(protected)/hotels/[id]/candidates/`. The partners app does NOT currently have a per-hotel route under `/hotels/[id]` (Phase 5 added admin-side `/hotels/[id]` only); this introduces it.

- `page.tsx` — server component, lists alive candidates for the hotel scoped via `is_hotel_user(hotelId)` (RLS enforces). Shows the current `approval_state` prominently and the 14-day countdown (if `candidate_list_approval_due_at` is set).
- `_components/AddCandidateManualFormHotel.tsx` — client component, same `useActionState` pattern. Disabled when list is not in an editable state.
- `_components/CandidateListTableHotel.tsx` — server component. Each row has a "Remove" affordance (disabled when not editable). No Google Places affordance, no CSV affordance (staff-only per locked decision 2).
- `_components/ApproveListButton.tsx` — client component, prominent. Renders a confirmation modal because approval is one-way ("Once approved, you can't edit this list without contacting Strictons. Are you sure?"). On confirm, submits to `approveCandidateList`. Disabled when not in `candidate_list_with_hotel`.

The partners-app top-level dashboard (currently the Phase 1 placeholder for hotels) gets a per-hotel card that links to `/hotels/[id]/candidates`.

---

## 6. Google Places integration — shape

### 6.1 Adapter

`apps/admin/lib/google-places.ts` — admin-app-private per Phase 5's locked decision (single caller for Phase 6; no second consumer; lift to `@strictons/places` package or a `@strictons/db/places` subpath only if Phase 7+ adds another caller).

```ts
// shape sketch (not the actual code)
export type PlaceResult = {
  placeId: string;
  name: string;
  formattedAddress?: string;
  primaryType?: string;
  location?: { lat: number; lng: number };
  phone?: string;        // formatted; from Place Details only
  websiteUri?: string;   // from Place Details only
};

export async function searchPlacesText(query: string): Promise<PlaceResult[]>;
export async function getPlaceDetails(placeId: string): Promise<PlaceResult>;
```

### 6.2 Library choice — raw `fetch`, not the `@googlemaps/places` SDK

Reasons:
- The SDK is heavy (~200 KB transitive), targets browser + Node, and adds an OAuth2 path we don't use (API-key-only).
- Two endpoints used (text search + details); the request bodies are small JSON, the response field masks are explicit; raw fetch is ~30 lines.
- Avoids a new vendor SDK in `package.json` whose semantic shape we'd then have to mock in tests. Raw fetch is trivially mockable via `vi.spyOn(globalThis, 'fetch')`.

### 6.3 Endpoints + field masks

- `POST https://places.googleapis.com/v1/places:searchText`
  - Body: `{ textQuery, maxResultCount: 10, languageCode: 'en-AU', regionCode: 'AU' }`
  - Header: `X-Goog-Api-Key: <GOOGLE_PLACES_API_KEY>`
  - Header: `X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.primaryType,places.location` (tight; explicitly excludes the priced "Advanced" + "Preferred" fields)
- `GET https://places.googleapis.com/v1/places/{placeId}`
  - Header: `X-Goog-Api-Key: <GOOGLE_PLACES_API_KEY>`
  - Header: `X-Goog-FieldMask: id,displayName,formattedAddress,primaryType,location,nationalPhoneNumber,websiteUri`
  - This call returns the contact + website fields we need at add time. They're in the "Contact" pricing tier, not the more expensive "Atmosphere" tier.

Pricing reference (Phase 6 cost-bounding):
- Text Search (Essentials + Pro fields): ~$0.025 / request after free
- Place Details (Essentials + Contact): ~$0.020 / request after free
- $200 monthly free credit → up to ~8,000 searches + details combined before charges
- At expected Phase 6 verification volume (~5 hotels × ~30 searches + ~15 details adds each = 225 calls) we stay deeply inside the free credit

### 6.4 Caching

Short-TTL in-memory cache keyed by normalised `query` (search) and `placeId` (details). TTL: 60 s for search, 600 s for details (place metadata is stable). Storage on `globalThis[Symbol.for('@strictons/admin/places-cache')]` to handle the Phase 3 module-instance-split gotcha. Capped LRU at 500 entries.

Persistent cache table deferred. The cost calculation above supports staying in-memory for Phase 6; a persistent table is justified only if (a) we hit the free-credit cap repeatedly, or (b) Strictons staff begin re-using the same searches across sessions in a way that warrants cross-session caching.

### 6.5 Error handling

- Validation: input through zod before any network call.
- Timeout: `AbortController` at 8 s per request; on timeout → typed `PlacesUpstreamError`.
- HTTP non-2xx: parse Google's error body for the message; raise `PlacesUpstreamError` with the status + message. The Server Action / Route Handler converts to a user-facing message.
- Empty results: not an error; the Server Action returns `{ ok: true, results: [] }`. UI says "no matches."

### 6.6 Secret name + provisioning

**Proposed env var: `GOOGLE_PLACES_API_KEY`.** Server-side only (no `NEXT_PUBLIC_` prefix — never bundled to the client). Required only in the admin app, not partners (partners doesn't call Places).

Provisioning is an operational task on you (see §11). Until the secret is set in Vercel and added as a GitHub Actions secret, the Server Action will fail loudly (typed error, audit-logged with `reason='missing_api_key'`).

---

## 7. CSV upload — shape

### 7.1 Where parsing happens

**Server Action.** The file lives in `FormData` as a `File`; the action reads `await file.text()`, runs it through papaparse, validates each row with `CsvRowSchema`, and inserts the valid rows in a single batch. No Route Handler.

Reasons over Route Handler:
- Server Actions natively integrate with `useActionState` for the per-row error UI; a Route Handler would force the client to manage the state by hand.
- File size is constrained (1 MB / 500 rows) — fits comfortably in the Server Action body-size budget without us extending Next's defaults.
- One transport for all admin candidate-list mutations (no API-vs-action boundary inside the same feature).

Reasons over client-side parsing:
- Trust boundary: the server is the validation authority. Client parsing would still need server validation. Doing it twice is redundant.
- One implementation to test.

### 7.2 Column contract (case-insensitive headers, trim on read)

| Column | Required | Notes |
|---|---|---|
| `name` | required | Non-empty after trim. Header missing → fatal parse error before per-row work. |
| `address` | optional | Trimmed to 500 chars max. |
| `category` | optional | Free text; 120 chars max. |
| `phone` | optional | Free text; 60 chars max. No format validation. |
| `website` | optional | Validated as URL; rejected per-row if not parseable. |
| `contact_email` | optional | Validated as email; rejected per-row if not parseable. |
| `distance_m` | optional | Coerced to non-negative integer; rejected per-row if not. |

Extra columns ignored silently (forwards-compat with future-Phase columns).

### 7.3 Library — `papaparse`

New dep request. Reasoning:
- The CSV spec has edge cases (quoted fields with embedded commas / newlines, BOM handling, line-ending variations) that a hand-rolled split gets wrong on real-world spreadsheet exports. Two staff users uploading an Excel-exported CSV with a description containing a comma would surface the gap immediately.
- papaparse is well-maintained, tree-shakes (we use only the synchronous string-parse path), and is small (~13 KB). The library has been around > 10 years.
- No alternative is materially lighter. `csv-parse` is comparable; `papaparse` is the marginally more conventional pick. Confirm in Q5.

Server-only (no client-side import). Lives in `apps/admin/lib/parse-candidates-csv.ts`.

### 7.4 Per-row error surfacing

Returns `rejected: [{ rowNumber, error: '...' }]` in the action state. The UI renders this as a list under the import summary. Rejected rows do NOT block successful rows — partial success is the default outcome on validation failures.

Single Postgres-level failure (e.g., a CHECK constraint violated by one of the valid rows that schema didn't catch) rolls the whole batch back. The action returns `{ ok: false, error: 'Import failed; no rows inserted.', rejected: [<original validation rejections>] }`. The user re-runs after fixing.

### 7.5 Temp file storage

None. The file is processed in-memory inside the Server Action. No Supabase Storage, no Cloudinary, no `/tmp`. The 1 MB cap keeps memory bounded.

---

## 8. Audit event types — all of them, frozen up front

Per Phase 5's frozen-event-name discipline, all new event names below. Existing actions (`hotel_admin_invite_*`, `portal_access_link_*`) are unchanged.

| `action` string | `actor_role` | When |
|---|---|---|
| `candidate_added` | `strictons_staff` | Successful add via manual or Google Places (staff-side). `after` includes `source` and identifying fields (name, google_place_id where relevant). |
| `candidate_added` | `hotel_admin` | Successful add via manual (hotel-side). Same shape; `actor_role` disambiguates. |
| `candidate_add_failed` | `strictons_staff` \| `hotel_admin` | Failed add. `after.reason` ∈ `{validation_failed, hotel_not_found, place_not_found, places_api_failed, duplicate_place, insert_failed, list_not_editable}` |
| `candidate_csv_imported` | `strictons_staff` | Successful CSV import. `after = { imported, rejected }` counts. |
| `candidate_csv_import_failed` | `strictons_staff` | Failed CSV import. `after.reason` ∈ `{validation_failed, oversized, too_many_rows, missing_name_column, parse_failed, insert_failed}` |
| `candidate_removed` | `strictons_staff` \| `hotel_admin` | Successful soft-delete. `after = { reason, removed_at }` |
| `candidate_remove_failed` | `strictons_staff` \| `hotel_admin` | Failed soft-delete. `after.reason` ∈ `{not_found, cross_hotel_smuggling, already_removed, list_not_editable, update_failed}` |
| `candidate_list_marked_ready_for_review` | `strictons_staff` | Successful transition `drafted → with_hotel`. `after = { candidate_list_approval_due_at }` |
| `candidate_list_marked_ready_for_review_failed` | `strictons_staff` | Failure. `after.reason` ∈ `{wrong_state, update_failed}` |
| `candidate_list_approved` | `hotel_admin` | Successful transition `with_hotel → approved`. `after = { approved_at }` |
| `candidate_list_approve_failed` | `hotel_admin` | Failure. `after.reason` ∈ `{wrong_state, update_failed}` |
| `candidate_list_reopened` | `strictons_staff` | Successful staff reopen. `after = { from_state, to_state }` |
| `candidate_list_reopen_failed` | `strictons_staff` | Failure. `after.reason` ∈ `{wrong_state, invalid_target_state, update_failed}` |

`entity_type` for candidate row actions: `'candidate_businesses'`. For list-state actions: `'hotels'` with `entity_id = hotelId`. All entries carry `entity_hotel_id = hotelId` for the per-hotel audit-scope index to do its job.

Naming considerations:
- Plain `candidate_added` (not `candidate_invited` / `candidate_proposed`) — to keep the language consistent with the UI verbs ("Add"). The `source` field disambiguates origin.
- `candidate_list_marked_ready_for_review` is verbose but unambiguous; preferred over `candidate_list_ready_for_review` (which reads as "the list is now ready", not "an actor marked it ready").
- Failure event names suffix `_failed` consistently with Phase 5's `hotel_admin_invite_failed` / `portal_access_link_resend_failed` pattern.

---

## 9. Test plan

### 9.1 pgTAP — new spec `tests/12_candidate_lists.spec.sql`

Coverage:
- Hotel admin can INSERT a row with `source='manual'`, `proposed_by=auth.uid()`, `status='proposed'`, into their own hotel. Asserts success.
- Hotel admin CANNOT INSERT with `source='csv'` or `source='google_places'`. Asserts policy violation.
- Hotel admin CANNOT INSERT into another hotel. Asserts policy violation.
- Hotel admin CANNOT INSERT with `proposed_by` set to a different user. Asserts policy violation.
- Hotel admin can UPDATE a row to set `removed_at=now(), removed_by=auth.uid(), status='removed_by_hotel', removal_reason='...'`. Asserts success.
- Hotel admin CANNOT UPDATE a row to set status to anything other than `removed_by_hotel` (e.g. `signed_to_placement`). Asserts policy violation.
- Hotel admin CANNOT UPDATE another hotel's row.
- Hotel admin can UPDATE `hotels.approval_state` from `candidate_list_with_hotel` to `candidate_list_approved` only. Asserts success.
- Hotel admin CANNOT UPDATE `hotels.approval_state` from any other state.
- Hotel admin CANNOT UPDATE `hotels.approval_state` to anything other than `candidate_list_approved`.
- The partial unique index rejects re-adding the same `(hotel_id, google_place_id)` when the previous row is alive.
- The partial unique index ALLOWS re-adding `(hotel_id, google_place_id)` after the previous row is `removed_at IS NOT NULL`.
- `candidate_businesses_removed_pair_check` rejects `removed_at` set without `removed_by` and vice versa.
- Unauth (anon) cannot SELECT, INSERT, UPDATE candidate_businesses.

Plus the existing test 21 in `01_unauth.spec.sql` (structural audit for orphan GRANTs) automatically catches the new column GRANTs without backing policies — no edit there needed.

### 9.2 Unit tests

- `packages/types/src/candidates.test.ts` — schema positive/negative cases.
- `apps/admin/lib/google-places.test.ts` — `fetch` mocked; happy path, 4xx error, 5xx error, timeout, field-mask presence, cache hit, cache miss, TTL expiry, LRU eviction at 500 entries, rate-limit-bucket-overflow behaviour.
- `apps/admin/lib/parse-candidates-csv.test.ts` — well-formed CSV; missing optional columns; missing required `name` column (fatal); quoted-comma fields; BOM-prefixed file; per-row validation failure mix; >500 rows (fatal); >1 MB (fatal); empty file.
- `apps/admin/app/(protected)/hotels/[id]/candidates/actions.test.ts` — every action, every branch (per Phase 5 pattern). `revalidatePath` mocked. `createServiceRoleClient` mocked.
- `apps/admin/app/api/places/search/route.test.ts` — auth gate, rate limit, success, validation failure, upstream error.
- `apps/partners/app/(protected)/hotels/[id]/candidates/actions.test.ts` — same coverage shape on the partners side.

### 9.3 Playwright

- `apps/admin/e2e/candidate-list.spec.ts` — admin-side single-app flow:
  - Staff signs in, navigates to hotel candidates page
  - Adds a manual candidate; asserts row appears in table
  - Searches Google Places (mocked via `page.route('https://places.googleapis.com/v1/places:searchText', …)`); adds top result; asserts row appears
  - Uploads a CSV with 3 valid rows + 1 invalid; asserts 3 rows added and the rejection error visible
  - Removes a row; asserts moved to removed panel
  - Clicks "Mark ready for hotel review"; asserts `hotels.approval_state` transitions
  - Clicks "Reopen"; asserts transitions back

- `apps/partners/e2e/approve-candidate-list.spec.ts` — partners-side single-app flow:
  - Hotel admin signs in via the existing magic-link helper (Phase 3); seed includes a hotel already at `candidate_list_with_hotel` with two candidates
  - Adds a manual candidate; asserts row appears
  - Removes a row; asserts removed
  - Clicks Approve → confirms in modal; asserts state moves to `candidate_list_approved`; asserts add/remove buttons now disabled

- `apps/admin/e2e/staff-builds-hotel-approves.spec.ts` — cross-app spec per locked decision 7 (local-partners-on-same-CI-runner pattern from Phase 5):
  - Service-role `beforeAll` provisions staff user, hotel at `candidate_list_drafted`, hotel admin invited+accepted
  - Staff context: add 2 candidates (manual + Google Places mocked); mark list ready
  - Hotel admin context: navigate `/hotels/[id]/candidates`; add 1 candidate; remove 1; click Approve
  - DB assertions: 2 alive + 1 removed candidates; `hotels.approval_state='candidate_list_approved'`; `candidate_list_approved_at` set
  - audit_log assertions: 2 staff `candidate_added`, 1 hotel `candidate_added`, 1 hotel `candidate_removed`, 1 staff `candidate_list_marked_ready_for_review`, 1 hotel `candidate_list_approved`
  - Teardown: ban both users via `banned_until` (Phase 5 pattern; audit_log + SET NULL FKs leave the hotel + candidates as orphans, which is correct)

The `e2e-admin.yml` workflow gains a step to provision the mocked Places responses (no real Google calls in CI; the spec uses `page.route` interception for the admin spec and the cross-app spec).

---

## 10. Commit sequence

Numbered, dependency-ordered, one logical change each.

1. **Migration 16 + pgTAP spec 12 + type regen.** Adds the columns, policies, indexes, and constraints in §1. Regenerates `database.types.ts`. New pgTAP spec covers the new RLS surface. CI gate: db-test, typecheck.

2. **`@strictons/types/candidates` subpath + unit tests.** Zod schemas + literal arrays. Adds `./candidates` to `packages/types/package.json` exports. Unit tests for every schema. No app changes yet.

3. **Google Places adapter (`apps/admin/lib/google-places.ts`) + unit tests.** Adapter, in-memory cache, rate-limit bucket. `fetch` mocked. No callers wired yet. New dep: none (raw `fetch`).

4. **CSV parser (`apps/admin/lib/parse-candidates-csv.ts`) + unit tests.** Includes the `papaparse` dep add — confirm in Q5 before this commit. No callers wired yet.

5. **Admin Server Actions: manual add + staff remove + mark-ready + reopen, plus unit tests.** Wires the simpler four actions first (no Google Places, no CSV). Audit events for these four wired. New `apps/admin/app/(protected)/hotels/[id]/candidates/{actions.ts, types.ts, actions.test.ts}`.

6. **Admin Server Action: `addCandidateFromGooglePlaces` + Route Handler `/api/places/search`, plus unit tests.** Wires the Places adapter into the action and the search Route Handler. `addCandidateFromGooglePlaces` audit event wired.

7. **Admin Server Action: `uploadCandidateCsv` + unit tests.** Wires the CSV parser into a Server Action. Audit event wired.

8. **Admin UI surfaces.** `page.tsx`, `_components/*`, route navigation from the existing `/hotels/[id]` page. End-to-end manual verification possible locally after this commit. CI gate adds the Playwright `candidate-list.spec.ts` run (admin single-app).

9. **Partners Server Actions: hotel manual add + hotel remove + hotel approve, plus unit tests.** New `apps/partners/app/(protected)/hotels/[id]/candidates/{actions.ts, types.ts, actions.test.ts}`. Audit events use `actor_role='hotel_admin'`.

10. **Partners UI surfaces.** `page.tsx`, `_components/*` including the approve-confirmation modal. CI gate adds `approve-candidate-list.spec.ts` (partners single-app).

11. **Cross-app E2E spec `staff-builds-hotel-approves.spec.ts`.** Lands in `apps/admin/e2e/` (lives where the workflow that exercises it lives, per Phase 5's `e2e-admin.yml` pattern). Path filter in `e2e-admin.yml` already covers partners paths from Phase 5; no new workflow.

12. **Operational follow-ups + `PROJECT_LOG.md` Phase 6 entry.** Any small fix-ups from verification. The PROJECT_LOG entry summarises What landed / Locked decisions / Gotchas / What's deferred per the established template.

Expected total: ~12 commits. The first three can land quickly; commits 5-7 are the bulk of the work; 8 and 10 are the UI; 11 is the cross-app proof.

---

## 11. Operational tasks for you

Things that belong on your task list, not mine, before the corresponding commits can land or verify:

| When | Task |
|---|---|
| Before commit 6 | **Provision Google Cloud project + enable Places API (New).** Create project (or reuse existing); enable Places API (New); create an API key restricted by HTTP referrer (server-side only — we can lock to Vercel egress IPs or just leave key-restricted since it never leaves the server). |
| Before commit 6 | **Confirm env var name `GOOGLE_PLACES_API_KEY`** (or supply alternative). Add to `apps/admin/.env.example` after confirmation. |
| Before commit 6 | **Add `GOOGLE_PLACES_API_KEY` to Vercel for the admin project only** (per Phase 4's hybrid env-var convention — app-specific, not team-shared, because partners doesn't use it). All three environments (Development, Preview, Production). |
| Before commit 6 | **Add `GOOGLE_PLACES_API_KEY` as a GitHub Actions secret** for the e2e-admin workflow — though the workflow will mock the upstream by default (no real Google calls in CI). The secret is there so the live Vercel preview can be exercised manually during verification. |
| Before commit 1 lands to dev | **Apply migration 16 to `strictons-dev` manually** via the auto-deploy workflow on push-to-main, OR via SQL Editor + `notify pgrst, 'reload schema'` if the feature branch needs it for in-branch verification (Phase 3 gotcha #1). |
| Before Phase 6 verification | **No prod Supabase work needed** — `strictons-prod` provisioning is still deferred (Phase 4 "what's deferred"). Phase 6 ships against dev only. |
| End of phase | **Manual verification on the Vercel preview** of the cross-app loop with a real Google Places response (with the real API key set on the preview). |

No new GitHub repo-level secrets beyond the Places API key. No new email-template secrets (no new email is sent in Phase 6). No new database connection strings.

---

## 12. Plan-review questions

**Q1 — List-state column placement.** §0.1 argues that the existing `hotels.approval_state` enum already encodes the lifecycle and that adding a new column would duplicate semantics. Locked decision 6 explicitly asks for my call. My call: use the existing enum, no new column or table. Do you agree?

**Q2 — `papaparse` as a new dep.** §7.3 argues for it over hand-rolled CSV splitting and over `csv-parse`. Are you OK with the new dep, or would you prefer hand-rolled for the constrained column contract we have? (If hand-rolled, I'll note edge cases like quoted-comma fields explicitly and we accept the upgrade work if a future column carries free-text commas.)

**Q3 — Staff-side `candidate_removed` status overload.** §3.1's `removeCandidateAsStaff` sets `status='removed_by_hotel'` even though the actor is staff, with the rationale that `removed_at`+`removed_by` are the canonical "is removed" signal and `removed_by_hotel` is the only available enum value. Alternative: append a new `removed_by_strictons` enum value (one-line migration; safe append). My preference: overload, because the `removed_by` column already captures the actor. Do you prefer the cleaner enum value (and one extra append-only migration)?

**Q4 — Reopen authority and reason capture.** Locked decision 6 says staff can reopen; the prompt asks whether reopens require both staff and hotel action or staff alone. My recommendation: staff alone, audit-logged. No "request to reopen" UX on the hotel side in Phase 6 (out of scope; if a hotel changes their mind, they email Strictons). Second sub-question: should `reopenCandidateList` capture a free-text `reason` (audit-only) at the time of reopening? Phase 6 inclination: no — defer to Phase 7+ if the audit history alone proves insufficient. Confirm both, or push back.

**Q5 — Google Places caching boundary.** §6.4 proposes short-TTL in-memory only (60s search, 600s details), `globalThis`-keyed. Persistent cache table deferred. The locked decision explicitly says to default to in-memory; the question is whether you want me to propose the persistent table now anyway because Phase 7+ adds more search traffic (the Place Details path during signing — which we could legitimately cache for days). My recommendation: leave the persistent table for Phase 7+ when there's a concrete second caller to justify it. Confirm or push back.

**Q6 — Narrowing the existing hotel-admin UPDATE policy on `candidate_businesses`.** §1 proposes dropping and recreating `candidate_businesses_update_hotel_admin` to remove the `status='approved'` allowed transition (because list-level approval supersedes per-row 'approved'). The alternative is leaving the existing policy as defended dead surface. My preference: narrow — the dead surface invites confusion if a future commit accidentally re-uses it. Are you OK with the policy change?

**Q7 — Partners-side hotel route placement.** §5 proposes new partners-app routes under `/hotels/[id]/candidates`. The partners app currently has no `/hotels/[id]` route at all (only `/members`). Phase 6 introduces it; future hotel-side surfaces (design meeting view, contact form, print-change requests) will live as siblings. Sanity-check: are you OK with `/hotels/[id]/candidates` as the URL shape (consistent with admin), or would you prefer a flatter `/candidates?hotel=...`? I prefer the nested shape — it matches admin and supports a future per-hotel landing page.

---

End of plan. No code lands until you've reviewed with your chat-side reviewer and the Q1-Q7 answers are settled.
