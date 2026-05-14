# Phase 6 plan — Candidate-list curation

Living spec for Phase 6. Plan-review questions answered inline in §12. No code in this round.

**Q-answers locked in this revision:** Q1 agreed (existing enum); Q2 agreed (papaparse, with header-normalisation note); Q3 reversed (new `removed_by_strictons` enum value); Q4 agreed (staff-alone reopen) + optional `reason` added; Q5 agreed (in-memory-only, per-instance) + rate-limit-is-best-effort note; Q6 agreed (drop+recreate policy, plus pgTAP audit result documented); Q7 agreed (nested partners route).

---

## 0. Up-front pushback

Two structural notes on the locked scope before the plan proper:

### 0.1 List-approval state — the existing `hotels.approval_state` enum already encodes it

The locked decision item 6 says "the exact state column placement (on `hotels`, on a new `candidate_lists` row, or inline) is YOUR design call." After re-reading `20260504100000_baseline.sql` lines 33-83 and `20260504100200_hotels.sql` lines 18-24, my call is **none of those three** — the existing `hotels.approval_state` enum and its associated due-date columns already model exactly this lifecycle:

| Phase 6 lifecycle name                    | Existing `hotel_approval_state` value |
| ----------------------------------------- | ------------------------------------- |
| `building` (staff researching)            | `candidate_list_drafted`              |
| `ready_for_review` (hotel can see + edit) | `candidate_list_with_hotel`           |
| `approved` (hotel locked in)              | `candidate_list_approved`             |

Plus `paused_awaiting_hotel_response` already covers the 14-day no-response case (baseline lines 44-48). The transition `candidate_list_drafted → candidate_list_with_hotel` is documented as "sets `candidate_list_approval_due_at = now() + 14 days`" — exactly the staff "mark ready for review" action. The transition `candidate_list_with_hotel → candidate_list_approved` is documented as "hotel_admin action via portal" — exactly the hotel approve action. Baseline line 70 spells out the design-meeting-held → candidate_list_drafted entry edge.

**Recommendation: do not add a new column or table for list state.** Wire the existing enum and existing due-date columns. The Phase 6 work becomes "implement the transitions that were always planned to live here", not "design a parallel state-tracking surface." This is asked formally as Q1 because the prompt called it out, but if you agree, the answer locks in and the rest of the plan assumes it.

If you disagree, the alternative shape is a new `hotels.candidate_list_state public.candidate_list_state` column plus enum — but it would duplicate the existing semantics with no extra signal, and would force two-column writes on every transition to keep them in sync.

### 0.2 Hotel-admin manual-add overlaps the existing UPDATE-policy semantics; INSERT policy needs adding

The current `candidate_businesses_insert_strictons` policy (migration 5 lines 64-66) restricts INSERT to Strictons staff. Locked decision item 2 ("hotel-side surface: full read + manual add + remove + approve") requires extending INSERT to hotel admins for `source='manual'`. This is a real RLS-policy addition, not a service-role-bypass — hotels add rows via their own authenticated session per the Phase 2 locked decision (no service-role from partners app for hotel-scoped writes). Detail in §3 below.

No pushback on items 1, 3, 4, 5, or 7. Item 6's framing answer is "use the existing enum" per §0.1.

---

## 1. Schema changes

One migration appended to the existing `candidate_businesses` table. No new tables. One append-only enum value added.

### Migration numbering — verification

`packages/db/supabase/migrations/` currently contains 15 files. PROJECT_LOG's "migration N" convention (Phase 3's PROJECT_LOG calls `20260505100000_partner_invite_tracking.sql` "migration 14") counts structural cluster migrations + structural follow-ups, treating the seed-mood-options reference-data migration consistently with PROJECT_LOG's narrative. By that convention, Phase 6's new migration is **migration 15**. The filename below uses a Phase-6-era timestamp prefix; the ordinal "migration 15" appears in commit messages and §10.

### Migration: `20260513100000_candidate_businesses_phase6.sql`

**Type:** append to existing `candidate_businesses` table. One enum value appended to `public.candidate_status`. No new tables.

**Shape (rough SQL):**

```sql
-- 0. Append `removed_by_strictons` to the candidate_status enum.
--    Per Q3 (revised): staff-side soft-deletes set status='removed_by_strictons';
--    hotel-side keeps status='removed_by_hotel'. Enum appends are safe and
--    append-only-compatible. The append must run in its own statement; the
--    new value is referenced by policies further down in the same migration,
--    which is supported in Postgres 14+ (no separate transaction required
--    for in-line use within the same migration in Supabase's runner).
alter type public.candidate_status add value if not exists 'removed_by_strictons';

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
- `proposed_by` is new. Phase 6 needs this to attribute hotel-manual-add rows to the hotel admin and staff-add rows to the staff user. See "`decided_by_user_id` clarification" immediately below for how the new column relates to the existing `decided_by_user_id` field.
- `phone`, `website`, `contact_email` cover the "candidate carries identifying data inline" half of locked decision 1. Social handles are deferred — they're a `businesses`-row concept per migration 4 and aren't needed until signing.
- The partial unique index on `(hotel_id, google_place_id)` filtered to alive + not-signed rows prevents the most likely staff mistake (re-adding the same Google place); doesn't block legitimate re-adds after removal (the original row's `removed_at` excludes it from the index).
- Per §0.1 (and Q6), the existing per-row `status='approved'` value is removed from the allowed hotel-admin UPDATE transitions. The enum value still exists (append-only enum rule), but no Phase 6 surface emits it or transitions to it. The vestigial value is documented with an in-migration comment so a future reader sees the deprecation intent.

### `decided_by_user_id` clarification — what it tracks now, post-Phase-6

The existing `candidate_businesses.decided_by_user_id` column was introduced in migration 5 alongside `decided_at` and is currently set by the Phase-2-locked hotel-admin UPDATE policy when a hotel admin transitions the row's status to `approved` or `removed_by_hotel`. The intent was a single "who acted on this row" column covering both approval and removal in one shape.

Phase 6 refines this. After Phase 6:

- **`proposed_by`** captures who added the row (staff or hotel admin), set once at INSERT and never updated.
- **`removed_by` + `removed_at`** capture who soft-deleted the row, set together at the removal transition.
- **`decided_by_user_id` + `decided_at`** retain their original purpose for the Phase 7+ Strictons-side `signed_to_placement` transition — i.e. "who recorded that this candidate signed and became a real business." The list-level approval the hotel now performs lives on `hotels.candidate_list_approved_at` per §0.1, NOT on per-row `decided_*` columns. The per-row `decided_*` columns are unused by Phase 6 hotel-side flows; they are reserved for Phase 7+ Strictons-side promotion bookkeeping.

The column is NOT redundant for the soft-delete case — `removed_by` carries that signal cleanly. But it IS redundant for the list-level approval case, which Phase 6 deliberately moves elsewhere. The column stays (append-only after applied — locked decision); Phase 6 code does not write or read it. A `COMMENT ON COLUMN` is added in the migration to document the post-Phase-6 semantics so a future reader doesn't re-purpose the column accidentally:

```sql
comment on column public.candidate_businesses.decided_by_user_id is
  'Reserved for Phase 7+ Strictons-side signed_to_placement bookkeeping. ' ||
  'Not written or read by Phase 6 code paths — hotel removal uses removed_by, ' ||
  'list-level approval lives on hotels.candidate_list_approved_at.';
comment on column public.candidate_businesses.decided_at is
  'Pairs with decided_by_user_id; same Phase 7+ reservation note.';
```

### Approval-state transition trigger (defense-in-depth backstop)

The two permissive UPDATE policies on `hotels` for authenticated callers (`hotels_update_admin_contact_email` from Phase 4 and the new `hotels_update_admin_approve_candidate_list` above) are OR'd by Postgres for both USING and WITH CHECK. The Phase 4 contact-email policy's WITH CHECK is loose (`is_hotel_admin(id)` only) because it relied on the column GRANT being `(contact_email)`-only to keep mutations scoped. Once Phase 6 adds `(approval_state, candidate_list_approved_at)` to the authenticated UPDATE GRANT, the loose policy's WITH CHECK lets a hotel admin write any `approval_state` value — column GRANTs gate WHICH columns may be written, not WHICH VALUES.

To preserve the lived "RLS as primary access control" convention from CLAUDE.md while still bounding what hotel admins can do with the now-grantable `approval_state` column, the migration adds a BEFORE UPDATE trigger on `hotels`:

- **Function name:** `public.enforce_hotel_approval_state_transitions()`
- **Trigger name:** `hotels_enforce_approval_state_transitions`
- **Fires WHEN:** `new.approval_state is distinct from old.approval_state` (no-op for contact_email-only updates so the existing Phase 4 path stays unaffected)
- **Bypass mechanism:** `current_user <> 'authenticated'`. Service-role / postgres / supabase_admin contexts skip the trigger body and `return new` immediately. Strictons-side transitions (drafted ↔ with_hotel, businesses_pitching, paused, etc.) all flow through service-role per the Phase 2 locked decision and are therefore unaffected.
- **Allow-branch (authenticated only):** exactly `old.approval_state = 'candidate_list_with_hotel'` → `new.approval_state = 'candidate_list_approved'` with `candidate_list_approved_at IS NOT NULL` and `is_hotel_admin(new.id) = true`. Any other authenticated-context transition raises with `SQLSTATE 42501`.

This matches the existing `hotels_slug_immutable` trigger pattern in shape (gating WHICH VALUES are allowed on a column), extended with a service-role bypass that the slug-immutable trigger doesn't need. The trigger is documented in spec 12 §9.1 with positive coverage (T11: allowed transition succeeds; T14: contact-email-only update isn't blocked; T16: service-role bypasses freely) and negative coverage (T12: reverse approve raises; T13: target other than `approved` raises; T15: composite contact_email + approval_state UPDATE raises). PROJECT_LOG's Phase 6 entry will record the rationale: defense in depth at the DB layer protects against future permissive-policy interactions that the OR semantics make difficult to gate via RLS alone.

### pgTAP audit for the Q6 policy narrowing

Audited specs 01, 02, 03, 04, 07, 08 (the candidate_businesses-touching suites) for any test that exercises the hotel-admin `status='approved'` UPDATE path being removed by the policy narrowing. **Audit result: no existing test exercises that path.** The current candidate_businesses tests cover:

- spec 01: anon SELECT denied → unaffected
- spec 02: service-role INSERT (Strictons curation path) → unaffected
- spec 03: hotel-A admin sees only their own list (SELECT) → unaffected
- spec 07: hotel-admin INSERT denied; service-role INSERT works → unaffected
- spec 08: service-role SELECT reachable → unaffected

The Q6 policy change is therefore additive to the test surface: the new spec 12 (§9.1) adds positive coverage for the now-allowed hotel-admin UPDATE soft-delete path and negative coverage asserting `status='approved'` UPDATE attempts by hotel admin are rejected. No existing spec needs an edit. Commit 1 lands the migration and spec 12 together; if a spec edit DID turn out to be needed, it would land in the same commit per the prompt.

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
  'proposed',
  'approved',
  'removed_by_hotel',
  'signed_to_placement',
  'removed_by_strictons',
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
  // Optional free-text reason (Q4). Surfaces in the audit log's `after`
  // payload only; no UI listing of past reasons in Phase 6 (audit-log
  // visibility is the read surface).
  reason: z.string().trim().max(500).optional().nullable(),
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
| Update shape | Service-role UPDATE: `{ removed_at: now(), removed_by: staffUserId, removal_reason: reason ?? null, status: 'removed_by_strictons' }` |

_Note on `status` for staff-side removal (Q3 — resolved):_ a new `removed_by_strictons` value is appended to `public.candidate_status` in the §1 migration. Staff-side removals set `status='removed_by_strictons'`; hotel-side removals continue to set `status='removed_by_hotel'`. The append is safe (enum-append is the canonical Postgres pattern). The `removed_at` + `removed_by` columns remain the canonical "is removed" filter; the status value carries the actor-class signal cleanly without overloading the hotel-only value.

| Returns success | `{ ok: true, message: 'Candidate removed.' }` |
| Audit | `candidate_removed`, `actor_role='strictons_staff'`, `after={ reason, removed_at, status: 'removed_by_strictons' }` |

#### Action: `markCandidateListReadyForReview(prev, formData) → MarkReadyState`

| Input | `FormData` with `hotelId` |
| Validates | `MarkListReadyForReviewInputSchema` |
| Preconditions | `hotels.approval_state` must be `candidate_list_drafted`. Otherwise return `{ ok: false, error: 'List is not in the drafted state.' }` |
| Update shape | Service-role UPDATE on `hotels`: `{ approval_state: 'candidate_list_with_hotel', candidate_list_approval_due_at: now() + interval '14 days' }` |
| Returns success | `{ ok: true, message: 'List ready for hotel review.' }` |
| Audit | `candidate_list_marked_ready_for_review`, `entity_type='hotels'`, `entity_id=<hotelId>`, `entity_hotel_id=<hotelId>`, `after={ candidate_list_approval_due_at }` |

#### Action: `reopenCandidateList(prev, formData) → ReopenState`

| Input | `FormData` with `hotelId`, `targetState` (`candidate_list_drafted` or `candidate_list_with_hotel`), optional `reason` |
| Validates | `ReopenCandidateListInputSchema` (now includes optional `reason` per Q4) |
| Preconditions | `hotels.approval_state` must be `candidate_list_approved` OR `candidate_list_with_hotel` (the latter is "un-mark-ready"). Reject other states. |
| Update shape | Service-role UPDATE on `hotels`: `{ approval_state: targetState, candidate_list_approved_at: null }`. If targetState is `candidate_list_drafted`, also clears `candidate_list_approval_due_at`; if it is `candidate_list_with_hotel`, leaves the existing due_at alone OR resets to `now() + 14 days` (recommend: leaves the existing — staff is correcting course, not restarting the clock). |
| Returns success | `{ ok: true, message: 'List reopened.' }` |
| Audit | `candidate_list_reopened`, `actor_role='strictons_staff'`, `after={ from_state, to_state, reason }` — `reason` present in payload when supplied, omitted (or `null`) when not. UI surfaces a single optional free-text input below the target-state selector. |

### 3.2 Route Handler — admin app — `apps/admin/app/api/places/search/route.ts`

`POST /api/places/search` (admin-only; staff session required; rate-limited).

| Auth gate | `requireStaff()` against the cookie-based server client (this is a Route Handler, not a Server Action — uses the partners-style `createServerClient` pattern from `@strictons/db/server`). If not staff → 401. |
| Request body | `{ query: string, hotelId: string }` validated with `GooglePlacesSearchInputSchema`. The `hotelId` is recorded in audit; it doesn't gate the search (any staff can search). |
| External call | Google Places Text Search via the adapter in §5. |
| Response success | `{ ok: true, results: Array<{ placeId, name, formattedAddress, primaryType?, location? }> }`. Capped at top 10 results. |
| Response failure | `{ ok: false, error: string }` with HTTP 400 (validation), 401 (unauth), 429 (rate-limit), 502 (upstream Google failure) status codes. |
| Rate limit | Per staff user, in-memory token bucket: 30 requests / 60 s. On overflow → 429 with `Retry-After` header. The bucket lives on `globalThis` keyed by `Symbol.for('@strictons/admin/places-rate-limit')` to survive the module-instance-split issue. **Per-Vercel-function-instance only — best-effort cost guard, not a security boundary (Q5).** A staff user routed to a second cold Vercel function instance gets a fresh bucket; the worst case is N×30 requests/min where N is the number of warm instances (in practice, 1-2 during Phase 6 verification volume). Persistent rate-limiting via a Supabase table is deferred alongside the persistent cache table; both arrive together if and when traffic patterns warrant. |
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
  phone?: string; // formatted; from Place Details only
  websiteUri?: string; // from Place Details only
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

**Per-Vercel-function-instance only** (same caveat as the rate limit in §3.2): a second cold function instance gets a fresh cache. The worst case is the same query being charged to Google once per warm instance per TTL window — at Phase 6 volume, negligible relative to the free credit. Persistent cache table deferred per Q5.

A persistent table is justified only if (a) we hit the free-credit cap repeatedly, (b) Strictons staff begin re-using the same searches across sessions in a way that warrants cross-session caching, or (c) Phase 7+ adds a second caller (e.g. signing-time place lookups) that legitimately benefits from days-long caching.

### 6.5 Error handling

Two typed error classes, distinguished so the caller can map them to the two audit reasons §6.6 names:

- **`PlacesConfigError`** — thrown when `GOOGLE_PLACES_API_KEY` is missing/empty. The adapter throws this _before_ any network call. Commit 6's Server Action does `instanceof PlacesConfigError` → audit `reason='missing_api_key'`.
- **`PlacesUpstreamError`** — thrown for any failure talking to Google: timeout, network error, or HTTP non-2xx. Carries an optional `status` (set for HTTP non-2xx, undefined for timeout/network). Commit 6's Server Action maps this → audit `reason='places_api_failed'`.

Behaviour:

- Validation: input through zod before any network call.
- Missing API key: `requireApiKey()` throws `PlacesConfigError` at the top of each request function, before `fetch` is reached.
- Timeout: `AbortController` at 8 s per request; an `AbortError` from the aborted fetch → `PlacesUpstreamError` with a "timed out" message (no `status`).
- HTTP non-2xx: parse Google's error body for the message; raise `PlacesUpstreamError` with the status + message. Non-JSON error bodies fall back to the HTTP status line. The Server Action / Route Handler converts to a user-facing message.
- Empty results: not an error; the Server Action returns `{ ok: true, results: [] }`. UI says "no matches." The adapter caches the empty array for the search TTL.

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

**Header normalisation (Q2 note):** papaparse does NOT lowercase or trim header names by default — it returns them verbatim from the CSV. Phase 6 normalises headers to `header.trim().toLowerCase()` via papaparse's `transformHeader` option, which runs at parse time (so both `meta.fields` and every row object's keys come back normalised — cleaner than a post-parse key remap). Spreadsheets that export with `Name`, `website`, `Contact_Email` etc. land on the right schema fields. The unit tests in §9.2 explicitly cover capitalised + whitespace-padded header variants.

| Column          | Required | Notes                                                                         |
| --------------- | -------- | ----------------------------------------------------------------------------- |
| `name`          | required | Non-empty after trim. Header missing → fatal parse error before per-row work. |
| `address`       | optional | Trimmed to 500 chars max.                                                     |
| `category`      | optional | Free text; 120 chars max.                                                     |
| `phone`         | optional | Free text; 60 chars max. No format validation.                                |
| `website`       | optional | Validated as URL; rejected per-row if not parseable.                          |
| `contact_email` | optional | Validated as email; rejected per-row if not parseable.                        |
| `distance_m`    | optional | Coerced to non-negative integer; rejected per-row if not.                     |

Extra columns ignored silently (forwards-compat with future-Phase columns).

**Empty-vs-header-only (both fatal, distinct messages).** The parser distinguishes two empty cases, each fatal (it refuses to return partial results):

- A zero-byte / whitespace-only file → `"The CSV file is empty."`
- A well-formed file with a header row but zero data rows → `"The CSV has no data rows."` Importing zero candidates is never a meaningful success; a header-only file is almost always the wrong file or a blank template.

The other fatal cases: file larger than 1 MiB (checked pre-parse on the decoded string's UTF-8 byte length — equals the original file size for UTF-8 input — to bound memory), missing the required `name` column, and more than 500 data rows (checked post-parse on the real, non-empty row count). Everything else — per-row validation failures — is non-fatal: the parser returns both the valid `rows` and the `rejected` list, and the Server Action owns the partial-success semantics.

**rowNumber semantics.** A rejection's `rowNumber` is the spreadsheet row the user sees in Excel: `dataIndex + 2` (+1 for 1-indexing, +1 for the header row). papaparse's `skipEmptyLines` is left OFF so every source line keeps its index; entirely-empty lines (a trailing newline, blank rows) are filtered out manually _after_ recording each surviving row's original index, so a mid-file blank line does not shift the rowNumbers of the rows below it.

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

| `action` string                               | `actor_role`                       | When                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidate_added`                             | `strictons_staff`                  | Successful add via manual or Google Places (staff-side). `after` includes `source` and identifying fields (name, google_place_id where relevant).                                                                                                          |
| `candidate_added`                             | `hotel_admin`                      | Successful add via manual (hotel-side). Same shape; `actor_role` disambiguates.                                                                                                                                                                            |
| `candidate_add_failed`                        | `strictons_staff` \| `hotel_admin` | Failed add. `after.reason` ∈ `{validation_failed, hotel_not_found, place_not_found, places_api_failed, duplicate_place, insert_failed, list_not_editable}`                                                                                                 |
| `candidate_csv_imported`                      | `strictons_staff`                  | Successful CSV import. `after = { imported, rejected }` counts.                                                                                                                                                                                            |
| `candidate_csv_import_failed`                 | `strictons_staff`                  | Failed CSV import. `after.reason` ∈ `{validation_failed, oversized, too_many_rows, missing_name_column, parse_failed, insert_failed}`                                                                                                                      |
| `candidate_removed`                           | `strictons_staff` \| `hotel_admin` | Successful soft-delete. `after = { reason, removed_at, status }` — `status` is `'removed_by_strictons'` for staff removals (Q3), `'removed_by_hotel'` for hotel removals.                                                                                  |
| `candidate_remove_failed`                     | `strictons_staff` \| `hotel_admin` | Failed soft-delete. `after.reason` ∈ `{validation_failed, not_found, cross_hotel_smuggling, already_removed, list_not_editable, update_failed}`                                                                                                            |
| `candidate_list_marked_ready_for_review`      | `strictons_staff`                  | Successful transition `drafted → with_hotel`. `after = { candidate_list_approval_due_at }`                                                                                                                                                                 |
| `candidate_list_mark_ready_for_review_failed` | `strictons_staff`                  | Failure. `after.reason` ∈ `{validation_failed, hotel_not_found, wrong_state, update_failed}`. **Verb-form on failure, matching Phase 5's `hotel_admin_invite_failed` convention.** Past-tense success name + verb-form failure name is the locked pattern. |
| `candidate_list_approved`                     | `hotel_admin`                      | Successful transition `with_hotel → approved`. `after = { approved_at }`                                                                                                                                                                                   |
| `candidate_list_approve_failed`               | `hotel_admin`                      | Failure. `after.reason` ∈ `{wrong_state, update_failed}`                                                                                                                                                                                                   |
| `candidate_list_reopened`                     | `strictons_staff`                  | Successful staff reopen. `after = { from_state, to_state, reason }` — `reason` present when supplied via the Q4 optional input, else `null` or absent.                                                                                                     |
| `candidate_list_reopen_failed`                | `strictons_staff`                  | Failure. `after.reason` ∈ `{validation_failed, hotel_not_found, wrong_state, invalid_target_state, update_failed}`                                                                                                                                         |

`entity_type` for candidate row actions: `'candidate_businesses'`. For list-state actions: `'hotels'` with `entity_id = hotelId`. All entries carry `entity_hotel_id = hotelId` for the per-hotel audit-scope index to do its job. For a `validation_failed` audit row the input identifiers haven't been validated, so `entity_id` uses `crypto.randomUUID()` (audit_log.entity_id is NOT NULL) and `entity_hotel_id` is `null` rather than risk an FK-violating value.

Naming considerations:

- Plain `candidate_added` (not `candidate_invited` / `candidate_proposed`) — to keep the language consistent with the UI verbs ("Add"). The `source` field disambiguates origin.
- `candidate_list_marked_ready_for_review` is verbose but unambiguous; preferred over `candidate_list_ready_for_review` (which reads as "the list is now ready", not "an actor marked it ready").
- Failure event names suffix `_failed` consistently with Phase 5's `hotel_admin_invite_failed` / `portal_access_link_resend_failed` pattern.

Reason-set extensions (commit 5, plan-review round): `validation_failed` was added to `candidate_remove_failed`, `candidate_list_mark_ready_for_review_failed`, and `candidate_list_reopen_failed` (it was already on `candidate_add_failed`); `hotel_not_found` was added to the two list-state failure events. A zod-validation failure caused by a tampered or malformed request is structurally distinct from a genuine wrong-state transition, and an audit `reason` that conflates them makes operational triage harder — the one-line-per-set cost is worth keeping the audit semantics clean rather than overloading `wrong_state` / `not_found`.

`invalid_target_state` (on `candidate_list_reopen_failed`) is the **no-op-transition guard**, distinct from `validation_failed`: the `targetState` is structurally valid (zod-checked against the two-value enum) but equals the hotel's current `approval_state`. Given the reopen FROM-state precondition (`approved` or `with_hotel`) and the two-value `targetState` enum (`drafted` or `with_hotel`), this is reachable only as `from=with_hotel, target=with_hotel` — a real staff mis-click ("reopen to the state it's already in").

---

## 9. Test plan

### 9.1 pgTAP — new spec `tests/12_candidate_lists.spec.sql`

Coverage:

- Hotel admin can INSERT a row with `source='manual'`, `proposed_by=auth.uid()`, `status='proposed'`, into their own hotel. Asserts success.
- Hotel admin CANNOT INSERT with `source='csv'` or `source='google_places'`. Asserts policy violation.
- Hotel admin CANNOT INSERT into another hotel. Asserts policy violation.
- Hotel admin CANNOT INSERT with `proposed_by` set to a different user. Asserts policy violation.
- Hotel admin can UPDATE a row to set `removed_at=now(), removed_by=auth.uid(), status='removed_by_hotel', removal_reason='...'`. Asserts success.
- Hotel admin CANNOT UPDATE a row to set status to anything other than `removed_by_hotel` (e.g. `signed_to_placement`, `approved`, or `removed_by_strictons`). Asserts policy violation for each. **The `status='approved'` rejection is the explicit Q6 narrowing assertion.**
- Hotel admin CANNOT UPDATE another hotel's row.
- Hotel admin can UPDATE `hotels.approval_state` from `candidate_list_with_hotel` to `candidate_list_approved` only (T11). Asserts success.
- **Approval-state trigger negative coverage** — Hotel admin attempting to reverse an approval (`approved → drafted`, T12) raises with `SQLSTATE 42501`; attempting to transition to a non-`approved` target value (`with_hotel → drafted`, T13) raises the same.
- **Approval-state trigger no-op coverage** — Contact-email-only UPDATE by hotel admin (no `approval_state` change, T14) still succeeds via the existing Phase 4 policy (regression guard: the trigger's `WHEN` clause must not fire here).
- **Approval-state trigger composite-UPDATE coverage** — Composite UPDATE that touches both `contact_email` and `approval_state` (T15) raises, demonstrating that the loose contact-email policy's WITH CHECK cannot bypass the trigger.
- **Approval-state trigger service-role bypass** — Service-role can transition `approval_state` freely (T16); verifies the `current_user <> 'authenticated'` bypass branch.
- **Service-role UPDATE setting `status='removed_by_strictons'` succeeds (Q3 path).** Bypasses RLS via service-role; verifies the enum append is wired and the column GRANT model lets the staff-side action work.
- The new `removed_by_strictons` enum value is present in `pg_enum`. (Schema-shape sanity check; cheap. The value is appended without `BEFORE`/`AFTER` so it lands last in `enumsortorder` — captured here as a check that the append ran.)
- The partial unique index rejects re-adding the same `(hotel_id, google_place_id)` when the previous row is alive.
- The partial unique index ALLOWS re-adding `(hotel_id, google_place_id)` after the previous row is `removed_at IS NOT NULL`.
- `candidate_businesses_removed_pair_check` rejects `removed_at` set without `removed_by` and vice versa.
- Unauth (anon) cannot SELECT, INSERT, UPDATE candidate_businesses.

Plus the existing test 21 in `01_unauth.spec.sql` (structural audit for orphan GRANTs) automatically catches the new column GRANTs without backing policies — no edit there needed. The Q6 audit (documented in §1) confirmed no existing spec needs an edit to accommodate the policy narrowing; new spec 12 carries the full positive + negative coverage.

### 9.2 Unit tests

- `packages/types/src/candidates.test.ts` — schema positive/negative cases.
- `apps/admin/lib/google-places.test.ts` — `fetch` mocked; happy path (search + details mapping), 4xx error, 5xx error, non-JSON error body, timeout, `PlacesConfigError` on a missing `GOOGLE_PLACES_API_KEY` (asserts it's `PlacesConfigError`, not `PlacesUpstreamError`, and that no `fetch` is made), field-mask presence (both endpoints), cache hit, case/whitespace-insensitive cache key, cache miss, search-vs-details independent TTLs, TTL expiry, LRU eviction at the 500-entry cap, LRU read-promotes, per-user rate-limit buckets, rate-limit-bucket-overflow + window reset.
- `apps/admin/lib/parse-candidates-csv.test.ts` — well-formed CSV; missing optional columns; missing required `name` column (fatal); quoted-comma fields; BOM-prefixed file; extra columns ignored; header normalisation (capitalised / uppercase / whitespace-padded / mixed-case `name`, plus `Contact_Email` → `contact_email`); per-row validation failure mix with spreadsheet rowNumbers; mid-file blank line preserves rowNumber alignment; trailing newline produces no spurious rejection; >500 rows (fatal) and exactly-500 accepted; >1 MiB (fatal); empty file (fatal); header-only file (fatal — distinct `"no data rows"` message).
- `apps/admin/app/(protected)/hotels/[id]/candidates/actions.test.ts` — every action, every branch (per Phase 5 pattern). `revalidatePath` mocked. `createServiceRoleClient` mocked. **Explicitly covers the `addCandidateFromGooglePlaces` Postgres 23505 → `duplicate_place` error-mapping branch** — i.e. when the partial unique index rejects the INSERT, the action returns `{ ok: false, fieldErrors: { placeId: '<message pointing at existing row>' } }` and audits `candidate_add_failed` with `reason: 'duplicate_place'`. (The constraint itself is tested at pgTAP level; the action's error-mapping is tested here.) Also covers the staff-removal status=`removed_by_strictons` write (Q3) and the reopen `reason` payload presence/absence (Q4).
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

**Commit 1 opens the draft PR** (per CLAUDE.md's "draft PRs open at the START of each phase, not the end" and Phase 4's lived convention). Subsequent commits push to the same PR. CI gates run on every push so failures surface inside the working loop rather than at end-of-phase merge time.

**If any CLAUDE.md convention surfaces during implementation** (e.g. a vendor-secret env var convention from the Google Places work, or an in-memory caching pattern worth codifying), the CLAUDE.md edit rides on the same Phase 6 PR — no standalone CLAUDE.md commit, consistent with the single-PR-per-phase convention.

1. **Migration 15 + pgTAP spec 12 + type regen.** Adds the enum append, columns, policies, indexes, and constraints in §1. Regenerates `database.types.ts`. New pgTAP spec covers the new RLS surface (including the Q6 narrowing assertion and the Q3 `removed_by_strictons` path). **Opens the draft PR with a placeholder body describing the phase scope.** CI gate: db-test, typecheck.

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

| When                         | Task                                                                                                                                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before commit 6              | **Provision Google Cloud project + enable Places API (New).** Create project (or reuse existing); enable Places API (New); create an API key restricted by HTTP referrer (server-side only — we can lock to Vercel egress IPs or just leave key-restricted since it never leaves the server). |
| Before commit 6              | **Confirm env var name `GOOGLE_PLACES_API_KEY`** (or supply alternative). Add to `apps/admin/.env.example` after confirmation.                                                                                                                                                                |
| Before commit 6              | **Add `GOOGLE_PLACES_API_KEY` to Vercel for the admin project only** (per Phase 4's hybrid env-var convention — app-specific, not team-shared, because partners doesn't use it). All three environments (Development, Preview, Production).                                                   |
| Before commit 6              | **Add `GOOGLE_PLACES_API_KEY` as a GitHub Actions secret** for the e2e-admin workflow — though the workflow will mock the upstream by default (no real Google calls in CI). The secret is there so the live Vercel preview can be exercised manually during verification.                     |
| Before commit 1 lands to dev | **Apply migration 15 to `strictons-dev` manually** via the auto-deploy workflow on push-to-main, OR via SQL Editor + `notify pgrst, 'reload schema'` if the feature branch needs it for in-branch verification (Phase 3 gotcha #1).                                                           |
| Before Phase 6 verification  | **No prod Supabase work needed** — `strictons-prod` provisioning is still deferred (Phase 4 "what's deferred"). Phase 6 ships against dev only.                                                                                                                                               |
| End of phase                 | **Manual verification on the Vercel preview** of the cross-app loop with a real Google Places response (with the real API key set on the preview).                                                                                                                                            |

No new GitHub repo-level secrets beyond the Places API key. No new email-template secrets (no new email is sent in Phase 6). No new database connection strings.

---

## 12. Plan-review questions — resolved

All Q1-Q7 settled in the review round. Recorded here for reference; the answers are already reflected in §§0-11 above (this is the living spec).

**Q1 — List-state column placement. RESOLVED: agreed.** Use the existing `hotels.approval_state` enum. No new column or table. (§0.1, §1, §3.)

**Q2 — `papaparse` as a new dep. RESOLVED: agreed.** Use papaparse. Headers normalised to `header.trim().toLowerCase()` before zod validation — papaparse does NOT do this by default. (§7.2, §7.3.)

**Q3 — Staff-side removal status. RESOLVED: append `removed_by_strictons`.** New enum value appended in the §1 migration. Staff-side removals set `status='removed_by_strictons'`; hotel-side keeps `status='removed_by_hotel'`. Reflected in `@strictons/types/candidates` literal array (§2), action contracts (§3.1), pgTAP coverage (§9.1), and audit shape (§8). (Reversed from the plan's original preference.)

**Q4 — Reopen authority + reason capture. RESOLVED: staff-alone reopen, optional `reason` added.** No hotel-side "request reopen" UX in Phase 6. `ReopenCandidateListInputSchema` gains an optional free-text `reason` field; the audit event's `after` payload becomes `{ from_state, to_state, reason? }`. (§2, §3.1, §8.)

**Q5 — Google Places caching boundary. RESOLVED: agreed.** In-memory only for Phase 6; persistent cache table deferred. Note added that the rate limit and cache are best-effort **per Vercel function instance** — acceptable as a cost guard, not as a security boundary. Persistent rate-limiting and persistent caching are deferred together. (§3.2, §6.4.)

**Q6 — Narrowing the existing hotel-admin UPDATE policy. RESOLVED: agreed.** Drop and recreate the policy in the new migration. **pgTAP audit completed (§1):** specs 01, 02, 03, 04, 07, 08 do not exercise the `status='approved'` hotel-admin UPDATE path; no existing spec needs an edit. New spec 12 carries the full positive + negative coverage including an explicit assertion that `status='approved'` UPDATE by hotel admin is rejected.

**Q7 — Partners-side hotel route placement. RESOLVED: agreed.** New routes under `apps/partners/app/(protected)/hotels/[id]/candidates/`. Future hotel-side surfaces (design meeting view, contact form, print-change requests) will live as siblings.

---

## 13. Additional plan updates (review-round resolutions)

Captured here so a future reader sees the full audit trail of the plan-review round's resolutions, alongside the §12 Q-answers.

1. **Migration ordinal verified.** `packages/db/supabase/migrations/` currently contains 15 files. By PROJECT_LOG's "migration N" convention (Phase 3 called `partner_invite_tracking` "migration 14"), Phase 6's new migration is **migration 15**. The plan now uses "Migration 15" in §1 framing and §10 commit 1. The filename's timestamp prefix is Phase-6-era; the ordinal is shorthand for prose.

2. **Audit event renaming.** `candidate_list_marked_ready_for_review_failed` → `candidate_list_mark_ready_for_review_failed` (verb-form failure name matching Phase 5's `hotel_admin_invite_failed` convention). The success event (`candidate_list_marked_ready_for_review`) stays past-tense per the locked pattern. (§8.)

3. **`decided_by_user_id` column clarification.** Added an explicit subsection in §1 documenting the column's post-Phase-6 semantics: it remains reserved for the Phase 7+ Strictons-side `signed_to_placement` bookkeeping; Phase 6 code does not write or read it. `removed_by` carries the soft-delete signal cleanly without overloading `decided_*`. A `COMMENT ON COLUMN` is added in the migration so future readers don't re-purpose the column accidentally.

4. **Draft PR opens at commit 1.** Codified explicitly in §10. Subsequent commits push to the same PR. If CLAUDE.md needs updates during implementation (vendor-secret env var convention, in-memory cache pattern, etc.), they ride on the same Phase 6 PR — no standalone CLAUDE.md commit.

5. **Actions-test coverage for the `duplicate_place` error path.** Explicitly listed in §9.2 — `addCandidateFromGooglePlaces` action test asserts that a Postgres 23505 from the partial unique index maps to `fieldErrors.placeId` and audits `candidate_add_failed` with `reason: 'duplicate_place'`. (The constraint is exercised at pgTAP level; the action's error-mapping is exercised here.)

---

End of plan. Plan-review round complete; all Q1-Q7 and additional update items are reflected above. The next round begins with commit 1 (migration 15 + pgTAP spec 12 + type regen + opens the draft PR), pending your "go".
