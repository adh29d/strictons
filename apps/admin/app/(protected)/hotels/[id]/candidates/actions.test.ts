import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ---------------------------------------------------------------

const createServiceRoleClientMock = vi.fn();
const writeAuditLogMock = vi.fn();
const revalidatePathMock = vi.fn();
const requireStaffMock = vi.fn();
const getPlaceDetailsMock = vi.fn();
const parseCandidatesCsvMock = vi.fn();

vi.mock('@strictons/db/client', () => ({
  createServiceRoleClient: () => createServiceRoleClientMock(),
}));
vi.mock('@strictons/db/audit', () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLogMock(...args),
}));
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));
vi.mock('@/lib/require-staff', () => ({
  requireStaff: () => requireStaffMock(),
}));
// getPlaceDetails is mocked; the PlacesConfigError / PlacesUpstreamError
// classes are kept REAL via importActual so `instanceof` holds inside
// addCandidateFromGooglePlaces (the Phase 5 EmailSendError pattern).
vi.mock('@/lib/google-places', async () => {
  const actual = await vi.importActual<typeof import('@/lib/google-places')>('@/lib/google-places');
  return {
    ...actual,
    getPlaceDetails: (...args: unknown[]) => getPlaceDetailsMock(...args),
  };
});
// parseCandidatesCsv is mocked at the apps/admin/lib boundary — the
// parser is its own tested boundary (commit 4); uploadCandidateCsv's
// tests control the parse result directly. papaparse is never mocked
// here.
vi.mock('@/lib/parse-candidates-csv', () => ({
  parseCandidatesCsv: (...args: unknown[]) => parseCandidatesCsvMock(...args),
}));

// ---- Constants -----------------------------------------------------------

const STAFF_USER_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_EMAIL = 'staff@strictons.test';
const HOTEL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_HOTEL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CANDIDATE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NEW_CANDIDATE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PLACE_ID = 'ChIJ_beachside_cafe';

type ChainResponse = { data: unknown; error: unknown };

/**
 * Service-role client stub. Each option overrides the default response
 * for one chain shape; `captured` records the payloads passed to the
 * mutating calls so tests can assert the INSERT / UPDATE shape.
 *
 *   hotels.select(...).eq('id', ...).maybeSingle()        → hotelLookup
 *   hotels.update(payload).eq('id', ...)                  → hotelUpdate
 *   candidate_businesses.select(...).eq('id',...).maybeSingle() → candidateLookup
 *   candidate_businesses.insert(payload).select('id').single() → candidateInsert
 *   await candidate_businesses.insert(payloads)            → candidateBatchInsert
 *   candidate_businesses.update(payload).eq('id', ...)    → candidateUpdate
 */
function makeServiceClient(
  opts: {
    hotelLookup?: ChainResponse;
    hotelUpdate?: ChainResponse;
    candidateLookup?: ChainResponse;
    candidateInsert?: ChainResponse;
    candidateBatchInsert?: ChainResponse;
    candidateUpdate?: ChainResponse;
  } = {},
) {
  const captured = {
    candidateInsert: [] as unknown[],
    candidateUpdate: [] as unknown[],
    hotelUpdate: [] as unknown[],
  };
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'hotels') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve(
                  opts.hotelLookup ?? {
                    data: { id: HOTEL_ID, approval_state: 'candidate_list_drafted' },
                    error: null,
                  },
                ),
              ),
            })),
          })),
          update: vi.fn((payload: unknown) => {
            captured.hotelUpdate.push(payload);
            return {
              eq: vi.fn(() => Promise.resolve(opts.hotelUpdate ?? { data: null, error: null })),
            };
          }),
        };
      }
      if (table === 'candidate_businesses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve(
                  opts.candidateLookup ?? {
                    data: { id: CANDIDATE_ID, hotel_id: HOTEL_ID, removed_at: null },
                    error: null,
                  },
                ),
              ),
            })),
          })),
          insert: vi.fn((payload: unknown) => {
            captured.candidateInsert.push(payload);
            const batchResult = opts.candidateBatchInsert ?? { data: null, error: null };
            return {
              // Single-row path: .insert(payload).select('id').single()
              // — addCandidateManualStaff / addCandidateFromGooglePlaces.
              select: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve(
                    opts.candidateInsert ?? { data: { id: NEW_CANDIDATE_ID }, error: null },
                  ),
                ),
              })),
              // Batch path: `await service.from(...).insert(payloads)` —
              // uploadCandidateCsv awaits the builder directly, so make
              // it thenable. The single-row path never awaits this
              // object (it chains .select().single()), so `then` is
              // dormant there.
              then: (resolve: (value: ChainResponse) => unknown) => resolve(batchResult),
            };
          }),
          update: vi.fn((payload: unknown) => {
            captured.candidateUpdate.push(payload);
            return {
              eq: vi.fn(() => Promise.resolve(opts.candidateUpdate ?? { data: null, error: null })),
            };
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { client, captured };
}

function auditEntry(action: string): Record<string, unknown> | undefined {
  const call = writeAuditLogMock.mock.calls.find(
    (c) => (c[0] as { action: string }).action === action,
  );
  return call?.[0] as Record<string, unknown> | undefined;
}

function makeManualFormData(
  opts: {
    hotelId?: string;
    name?: string;
    address?: string;
    phone?: string;
    website?: string;
    contactEmail?: string;
    distanceM?: string;
  } = {},
): FormData {
  const fd = new FormData();
  fd.set('hotelId', opts.hotelId ?? HOTEL_ID);
  fd.set('name', opts.name ?? 'Beachside Cafe');
  if (opts.address !== undefined) fd.set('address', opts.address);
  if (opts.phone !== undefined) fd.set('phone', opts.phone);
  if (opts.website !== undefined) fd.set('website', opts.website);
  if (opts.contactEmail !== undefined) fd.set('contactEmail', opts.contactEmail);
  if (opts.distanceM !== undefined) fd.set('distanceM', opts.distanceM);
  return fd;
}

function makeRemoveFormData(
  opts: { hotelId?: string; candidateId?: string; reason?: string } = {},
): FormData {
  const fd = new FormData();
  fd.set('hotelId', opts.hotelId ?? HOTEL_ID);
  fd.set('candidateId', opts.candidateId ?? CANDIDATE_ID);
  if (opts.reason !== undefined) fd.set('reason', opts.reason);
  return fd;
}

function makeMarkReadyFormData(opts: { hotelId?: string } = {}): FormData {
  const fd = new FormData();
  fd.set('hotelId', opts.hotelId ?? HOTEL_ID);
  return fd;
}

function makeReopenFormData(
  opts: { hotelId?: string; targetState?: string; reason?: string } = {},
): FormData {
  const fd = new FormData();
  fd.set('hotelId', opts.hotelId ?? HOTEL_ID);
  fd.set('targetState', opts.targetState ?? 'candidate_list_drafted');
  if (opts.reason !== undefined) fd.set('reason', opts.reason);
  return fd;
}

function makeGooglePlacesFormData(
  opts: { hotelId?: string; placeId?: string; category?: string } = {},
): FormData {
  const fd = new FormData();
  fd.set('hotelId', opts.hotelId ?? HOTEL_ID);
  fd.set('placeId', opts.placeId ?? PLACE_ID);
  if (opts.category !== undefined) fd.set('category', opts.category);
  return fd;
}

/** A Place Details result as the commit-3 adapter would return it. */
function makePlaceResult(overrides: Record<string, unknown> = {}) {
  return {
    placeId: PLACE_ID,
    name: 'Beachside Cafe',
    formattedAddress: '1 Beach Rd, Sydney NSW',
    primaryType: 'cafe',
    location: { lat: -33.8, lng: 151.2 },
    phone: '(02) 1234 5678',
    websiteUri: 'https://beachside.example',
    ...overrides,
  };
}

/**
 * FormData for uploadCandidateCsv. `file` defaults to a real File (so
 * the action's `await file.text()` resolves — the parse result itself
 * is controlled by parseCandidatesCsvMock). Pass `file: null` to omit
 * it, or `file: 'a string'` to submit a non-File entry.
 */
function makeCsvFormData(opts: { hotelId?: string; file?: File | string | null } = {}): FormData {
  const fd = new FormData();
  fd.set('hotelId', opts.hotelId ?? HOTEL_ID);
  if (opts.file === null) {
    // omit the file entry entirely
  } else if (typeof opts.file === 'string') {
    fd.set('file', opts.file);
  } else {
    fd.set('file', opts.file ?? new File(['name\nCafe\n'], 'candidates.csv', { type: 'text/csv' }));
  }
  return fd;
}

beforeEach(() => {
  vi.resetModules();
  createServiceRoleClientMock.mockReset();
  writeAuditLogMock.mockReset();
  writeAuditLogMock.mockResolvedValue(undefined);
  revalidatePathMock.mockReset();
  requireStaffMock.mockReset();
  getPlaceDetailsMock.mockReset();
  parseCandidatesCsvMock.mockReset();
  requireStaffMock.mockResolvedValue({
    kind: 'ok',
    userId: STAFF_USER_ID,
    email: STAFF_EMAIL,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// addCandidateManualStaff
// ===========================================================================

describe('addCandidateManualStaff', () => {
  it('happy path — INSERTs the candidate, audits candidate_added, revalidates both routes', async () => {
    const { client, captured } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(client);

    const { addCandidateManualStaff } = await import('./actions');
    const state = await addCandidateManualStaff(
      {},
      makeManualFormData({
        name: 'Beachside Cafe',
        address: '1 Beach Rd',
        website: 'https://beachside.example',
        contactEmail: 'hi@beachside.example',
        distanceM: '350',
      }),
    );

    expect(state).toEqual({
      ok: true,
      message: 'Candidate added.',
      candidateId: NEW_CANDIDATE_ID,
    });

    expect(captured.candidateInsert).toHaveLength(1);
    expect(captured.candidateInsert[0]).toEqual({
      hotel_id: HOTEL_ID,
      source: 'manual',
      name: 'Beachside Cafe',
      address: '1 Beach Rd',
      category: null,
      distance_m: 350,
      phone: null,
      website: 'https://beachside.example',
      contact_email: 'hi@beachside.example',
      proposed_by: STAFF_USER_ID,
      status: 'proposed',
    });

    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]');
    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]/candidates');

    const success = auditEntry('candidate_added');
    expect(success).toMatchObject({
      actor_role: 'strictons_staff',
      entity_type: 'candidate_businesses',
      entity_id: NEW_CANDIDATE_ID,
      entity_hotel_id: HOTEL_ID,
      after: { source: 'manual', name: 'Beachside Cafe' },
    });
  });

  it('maps undefined optional fields to null in the INSERT payload', async () => {
    const { client, captured } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(client);

    const { addCandidateManualStaff } = await import('./actions');
    await addCandidateManualStaff({}, makeManualFormData({ name: 'Bare Candidate' }));

    expect(captured.candidateInsert[0]).toMatchObject({
      address: null,
      category: null,
      distance_m: null,
      phone: null,
      website: null,
      contact_email: null,
    });
  });

  it('rejects when caller is not staff (no service client, no audit)', async () => {
    requireStaffMock.mockResolvedValue({ kind: 'error', error: 'Not signed in.' });

    const { addCandidateManualStaff } = await import('./actions');
    const state = await addCandidateManualStaff({}, makeManualFormData());

    expect(state).toEqual({ error: 'Not signed in.' });
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(writeAuditLogMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('audits validation_failed and returns fieldErrors for invalid input', async () => {
    const { addCandidateManualStaff } = await import('./actions');
    // Empty name + non-URL website.
    const state = await addCandidateManualStaff(
      {},
      makeManualFormData({ name: '   ', website: 'not-a-url' }),
    );

    expect(state.ok).toBeUndefined();
    expect(state.error).toBe('Please fix the errors below.');
    expect(state.fieldErrors?.name).toBeDefined();
    expect(state.fieldErrors?.website).toBeDefined();
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();

    expect(auditEntry('candidate_add_failed')).toMatchObject({
      after: { reason: 'validation_failed' },
    });
  });

  it('audits hotel_not_found when the hotel SELECT returns no row', async () => {
    const { client } = makeServiceClient({ hotelLookup: { data: null, error: null } });
    createServiceRoleClientMock.mockReturnValue(client);

    const { addCandidateManualStaff } = await import('./actions');
    const state = await addCandidateManualStaff({}, makeManualFormData());

    expect(state).toEqual({ error: 'Hotel not found.' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_add_failed')).toMatchObject({
      after: { reason: 'hotel_not_found' },
    });
  });

  it('audits insert_failed when the INSERT errors', async () => {
    const { client } = makeServiceClient({
      candidateInsert: { data: null, error: { message: 'insert boom' } },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { addCandidateManualStaff } = await import('./actions');
    const state = await addCandidateManualStaff({}, makeManualFormData());

    expect(state).toEqual({ error: 'Could not add candidate. Please try again.' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    const failure = auditEntry('candidate_add_failed');
    expect(failure).toMatchObject({
      entity_hotel_id: HOTEL_ID,
      after: { reason: 'insert_failed', message: 'insert boom' },
    });
  });
});

// ===========================================================================
// removeCandidateAsStaff
// ===========================================================================

describe('removeCandidateAsStaff', () => {
  it('happy path — soft-deletes with status=removed_by_strictons, audits, revalidates', async () => {
    const { client, captured } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(client);

    const { removeCandidateAsStaff } = await import('./actions');
    const state = await removeCandidateAsStaff(
      {},
      makeRemoveFormData({ reason: 'permanently closed' }),
    );

    expect(state).toEqual({ ok: true, message: 'Candidate removed.' });

    expect(captured.candidateUpdate).toHaveLength(1);
    const updatePayload = captured.candidateUpdate[0] as Record<string, unknown>;
    expect(updatePayload).toMatchObject({
      removed_by: STAFF_USER_ID,
      removal_reason: 'permanently closed',
      status: 'removed_by_strictons',
    });
    expect(typeof updatePayload.removed_at).toBe('string');

    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]');
    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]/candidates');

    const success = auditEntry('candidate_removed');
    expect(success).toMatchObject({
      actor_role: 'strictons_staff',
      entity_type: 'candidate_businesses',
      entity_id: CANDIDATE_ID,
      entity_hotel_id: HOTEL_ID,
      after: { reason: 'permanently closed', status: 'removed_by_strictons' },
    });
    // removed_at in the audit equals the removed_at written to the row.
    expect((success?.after as { removed_at: string }).removed_at).toBe(updatePayload.removed_at);
  });

  it('records removal_reason as null when no reason is supplied', async () => {
    const { client, captured } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(client);

    const { removeCandidateAsStaff } = await import('./actions');
    await removeCandidateAsStaff({}, makeRemoveFormData());

    expect((captured.candidateUpdate[0] as Record<string, unknown>).removal_reason).toBeNull();
    expect(auditEntry('candidate_removed')).toMatchObject({ after: { reason: null } });
  });

  it('rejects when caller is not staff', async () => {
    requireStaffMock.mockResolvedValue({ kind: 'error', error: 'Not signed in.' });

    const { removeCandidateAsStaff } = await import('./actions');
    const state = await removeCandidateAsStaff({}, makeRemoveFormData());

    expect(state).toEqual({ error: 'Not signed in.' });
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it('audits validation_failed for a malformed candidateId', async () => {
    const { removeCandidateAsStaff } = await import('./actions');
    const state = await removeCandidateAsStaff(
      {},
      makeRemoveFormData({ candidateId: 'not-a-uuid' }),
    );

    expect(state).toEqual({ error: 'Invalid remove request.' });
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_remove_failed')).toMatchObject({
      after: { reason: 'validation_failed' },
    });
  });

  it('audits not_found when the candidate SELECT returns no row', async () => {
    const { client } = makeServiceClient({ candidateLookup: { data: null, error: null } });
    createServiceRoleClientMock.mockReturnValue(client);

    const { removeCandidateAsStaff } = await import('./actions');
    const state = await removeCandidateAsStaff({}, makeRemoveFormData());

    expect(state).toEqual({ error: 'Candidate not found.' });
    expect(auditEntry('candidate_remove_failed')).toMatchObject({
      after: { reason: 'not_found' },
    });
  });

  it('rejects cross-hotel id smuggling (candidate.hotel_id !== submitted hotelId)', async () => {
    const { client } = makeServiceClient({
      candidateLookup: {
        data: { id: CANDIDATE_ID, hotel_id: OTHER_HOTEL_ID, removed_at: null },
        error: null,
      },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { removeCandidateAsStaff } = await import('./actions');
    const state = await removeCandidateAsStaff({}, makeRemoveFormData());

    // Same user-facing error as not-found — don't leak the other hotel's row.
    expect(state).toEqual({ error: 'Candidate not found.' });
    const failure = auditEntry('candidate_remove_failed');
    expect(failure).toMatchObject({
      after: {
        reason: 'cross_hotel_smuggling',
        submitted_hotel_id: HOTEL_ID,
        actual_hotel_id: OTHER_HOTEL_ID,
      },
    });
  });

  it('audits already_removed when the candidate is already soft-deleted', async () => {
    const REMOVED_AT = '2026-05-01T10:00:00.000Z';
    const { client } = makeServiceClient({
      candidateLookup: {
        data: { id: CANDIDATE_ID, hotel_id: HOTEL_ID, removed_at: REMOVED_AT },
        error: null,
      },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { removeCandidateAsStaff } = await import('./actions');
    const state = await removeCandidateAsStaff({}, makeRemoveFormData());

    expect(state).toEqual({ error: 'This candidate has already been removed.' });
    expect(auditEntry('candidate_remove_failed')).toMatchObject({
      after: { reason: 'already_removed', removed_at: REMOVED_AT },
    });
  });

  it('audits update_failed when the soft-delete UPDATE errors', async () => {
    const { client } = makeServiceClient({
      candidateUpdate: { data: null, error: { message: 'update boom' } },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { removeCandidateAsStaff } = await import('./actions');
    const state = await removeCandidateAsStaff({}, makeRemoveFormData());

    expect(state).toEqual({ error: 'Could not remove the candidate. Please try again.' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_remove_failed')).toMatchObject({
      after: { reason: 'update_failed', message: 'update boom' },
    });
  });
});

// ===========================================================================
// markCandidateListReadyForReview
// ===========================================================================

describe('markCandidateListReadyForReview', () => {
  it('happy path — transitions drafted -> with_hotel, sets the due date, audits, revalidates', async () => {
    const { client, captured } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(client);

    const { markCandidateListReadyForReview } = await import('./actions');
    const state = await markCandidateListReadyForReview({}, makeMarkReadyFormData());

    expect(state).toEqual({ ok: true, message: 'List ready for hotel review.' });

    expect(captured.hotelUpdate).toHaveLength(1);
    const payload = captured.hotelUpdate[0] as Record<string, unknown>;
    expect(payload.approval_state).toBe('candidate_list_with_hotel');
    expect(typeof payload.candidate_list_approval_due_at).toBe('string');
    // Due date ~14 days out.
    const dueMs = new Date(payload.candidate_list_approval_due_at as string).getTime();
    const deltaDays = (dueMs - Date.now()) / (24 * 60 * 60 * 1000);
    expect(deltaDays).toBeGreaterThan(13.9);
    expect(deltaDays).toBeLessThan(14.1);

    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]');
    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]/candidates');

    const success = auditEntry('candidate_list_marked_ready_for_review');
    expect(success).toMatchObject({
      actor_role: 'strictons_staff',
      entity_type: 'hotels',
      entity_id: HOTEL_ID,
      entity_hotel_id: HOTEL_ID,
    });
    expect(
      (success?.after as { candidate_list_approval_due_at: string }).candidate_list_approval_due_at,
    ).toBe(payload.candidate_list_approval_due_at);
  });

  it('rejects when caller is not staff', async () => {
    requireStaffMock.mockResolvedValue({ kind: 'error', error: 'Not signed in.' });

    const { markCandidateListReadyForReview } = await import('./actions');
    const state = await markCandidateListReadyForReview({}, makeMarkReadyFormData());

    expect(state).toEqual({ error: 'Not signed in.' });
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it('audits validation_failed for a malformed hotelId', async () => {
    const { markCandidateListReadyForReview } = await import('./actions');
    const state = await markCandidateListReadyForReview(
      {},
      makeMarkReadyFormData({ hotelId: 'not-a-uuid' }),
    );

    expect(state).toEqual({ error: 'Invalid request.' });
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_list_mark_ready_for_review_failed')).toMatchObject({
      after: { reason: 'validation_failed' },
    });
  });

  it('audits hotel_not_found when the hotel SELECT returns no row', async () => {
    const { client } = makeServiceClient({ hotelLookup: { data: null, error: null } });
    createServiceRoleClientMock.mockReturnValue(client);

    const { markCandidateListReadyForReview } = await import('./actions');
    const state = await markCandidateListReadyForReview({}, makeMarkReadyFormData());

    expect(state).toEqual({ error: 'Hotel not found.' });
    expect(auditEntry('candidate_list_mark_ready_for_review_failed')).toMatchObject({
      after: { reason: 'hotel_not_found' },
    });
  });

  it('hotel_not_found audit passes entity_hotel_id: null (commit-5 FK-violation regression)', async () => {
    // audit_log.entity_hotel_id is a FK to hotels(id); the hotel that
    // triggered hotel_not_found does not exist, so passing its id would
    // FK-violate the audit INSERT. Commit 5 shipped this branch with
    // entity_hotel_id: hotelId — latent because writeAuditLog swallows
    // the FK error. This is the assertion that would have caught it.
    const { client } = makeServiceClient({ hotelLookup: { data: null, error: null } });
    createServiceRoleClientMock.mockReturnValue(client);

    const { markCandidateListReadyForReview } = await import('./actions');
    await markCandidateListReadyForReview({}, makeMarkReadyFormData());

    const entry = auditEntry('candidate_list_mark_ready_for_review_failed');
    expect(entry?.entity_hotel_id).toBeNull();
  });

  it('audits wrong_state when the hotel is not in candidate_list_drafted', async () => {
    const { client } = makeServiceClient({
      hotelLookup: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_with_hotel' },
        error: null,
      },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { markCandidateListReadyForReview } = await import('./actions');
    const state = await markCandidateListReadyForReview({}, makeMarkReadyFormData());

    expect(state).toEqual({ error: 'List is not in the drafted state.' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_list_mark_ready_for_review_failed')).toMatchObject({
      after: { reason: 'wrong_state' },
    });
  });

  it('audits update_failed when the hotel UPDATE errors', async () => {
    const { client } = makeServiceClient({
      hotelUpdate: { data: null, error: { message: 'update boom' } },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { markCandidateListReadyForReview } = await import('./actions');
    const state = await markCandidateListReadyForReview({}, makeMarkReadyFormData());

    expect(state).toEqual({ error: 'Could not update the list. Please try again.' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_list_mark_ready_for_review_failed')).toMatchObject({
      after: { reason: 'update_failed', message: 'update boom' },
    });
  });
});

// ===========================================================================
// reopenCandidateList
// ===========================================================================

describe('reopenCandidateList', () => {
  it('happy path — reopens approved -> drafted, clears approved_at + due_at, audits with reason', async () => {
    const { client, captured } = makeServiceClient({
      hotelLookup: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_approved' },
        error: null,
      },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { reopenCandidateList } = await import('./actions');
    const state = await reopenCandidateList(
      {},
      makeReopenFormData({
        targetState: 'candidate_list_drafted',
        reason: 'hotel wants more options',
      }),
    );

    expect(state).toEqual({ ok: true, message: 'List reopened.' });

    expect(captured.hotelUpdate).toHaveLength(1);
    expect(captured.hotelUpdate[0]).toEqual({
      approval_state: 'candidate_list_drafted',
      candidate_list_approved_at: null,
      candidate_list_approval_due_at: null,
    });

    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]');
    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]/candidates');

    expect(auditEntry('candidate_list_reopened')).toMatchObject({
      actor_role: 'strictons_staff',
      entity_type: 'hotels',
      entity_id: HOTEL_ID,
      entity_hotel_id: HOTEL_ID,
      after: {
        from_state: 'candidate_list_approved',
        to_state: 'candidate_list_drafted',
        reason: 'hotel wants more options',
      },
    });
  });

  it('reopening approved -> with_hotel clears approved_at but leaves due_at untouched; reason null when absent', async () => {
    const { client, captured } = makeServiceClient({
      hotelLookup: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_approved' },
        error: null,
      },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { reopenCandidateList } = await import('./actions');
    const state = await reopenCandidateList(
      {},
      makeReopenFormData({ targetState: 'candidate_list_with_hotel' }),
    );

    expect(state).toEqual({ ok: true, message: 'List reopened.' });
    // due_at is NOT in the payload — staff is correcting course, not
    // restarting the 14-day clock.
    expect(captured.hotelUpdate[0]).toEqual({
      approval_state: 'candidate_list_with_hotel',
      candidate_list_approved_at: null,
    });
    expect(auditEntry('candidate_list_reopened')).toMatchObject({
      after: {
        from_state: 'candidate_list_approved',
        to_state: 'candidate_list_with_hotel',
        reason: null,
      },
    });
  });

  it('rejects when caller is not staff', async () => {
    requireStaffMock.mockResolvedValue({ kind: 'error', error: 'Not signed in.' });

    const { reopenCandidateList } = await import('./actions');
    const state = await reopenCandidateList({}, makeReopenFormData());

    expect(state).toEqual({ error: 'Not signed in.' });
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it('audits validation_failed for a targetState outside the two-value enum', async () => {
    const { reopenCandidateList } = await import('./actions');
    const state = await reopenCandidateList(
      {},
      makeReopenFormData({ targetState: 'candidate_list_approved' }),
    );

    expect(state).toEqual({ error: 'Invalid reopen request.' });
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_list_reopen_failed')).toMatchObject({
      after: { reason: 'validation_failed' },
    });
  });

  it('audits hotel_not_found when the hotel SELECT returns no row', async () => {
    const { client } = makeServiceClient({ hotelLookup: { data: null, error: null } });
    createServiceRoleClientMock.mockReturnValue(client);

    const { reopenCandidateList } = await import('./actions');
    const state = await reopenCandidateList({}, makeReopenFormData());

    expect(state).toEqual({ error: 'Hotel not found.' });
    expect(auditEntry('candidate_list_reopen_failed')).toMatchObject({
      after: { reason: 'hotel_not_found' },
    });
  });

  it('hotel_not_found audit passes entity_hotel_id: null (commit-5 FK-violation regression)', async () => {
    // audit_log.entity_hotel_id is a FK to hotels(id); the hotel that
    // triggered hotel_not_found does not exist, so passing its id would
    // FK-violate the audit INSERT. Commit 5 shipped this branch with
    // entity_hotel_id: hotelId — latent because writeAuditLog swallows
    // the FK error. This is the assertion that would have caught it.
    const { client } = makeServiceClient({ hotelLookup: { data: null, error: null } });
    createServiceRoleClientMock.mockReturnValue(client);

    const { reopenCandidateList } = await import('./actions');
    await reopenCandidateList({}, makeReopenFormData());

    const entry = auditEntry('candidate_list_reopen_failed');
    expect(entry?.entity_hotel_id).toBeNull();
  });

  it('audits wrong_state when the hotel is not in a reopenable state', async () => {
    const { client } = makeServiceClient({
      hotelLookup: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_drafted' },
        error: null,
      },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { reopenCandidateList } = await import('./actions');
    const state = await reopenCandidateList({}, makeReopenFormData());

    expect(state).toEqual({ error: 'List cannot be reopened from its current state.' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_list_reopen_failed')).toMatchObject({
      after: { reason: 'wrong_state' },
    });
  });

  it('audits invalid_target_state for a no-op reopen (with_hotel -> with_hotel)', async () => {
    const { client } = makeServiceClient({
      hotelLookup: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_with_hotel' },
        error: null,
      },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { reopenCandidateList } = await import('./actions');
    const state = await reopenCandidateList(
      {},
      makeReopenFormData({ targetState: 'candidate_list_with_hotel' }),
    );

    expect(state).toEqual({ error: 'The list is already in that state.' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_list_reopen_failed')).toMatchObject({
      after: { reason: 'invalid_target_state' },
    });
  });

  it('audits update_failed when the hotel UPDATE errors', async () => {
    const { client } = makeServiceClient({
      hotelLookup: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_approved' },
        error: null,
      },
      hotelUpdate: { data: null, error: { message: 'update boom' } },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { reopenCandidateList } = await import('./actions');
    const state = await reopenCandidateList({}, makeReopenFormData());

    expect(state).toEqual({ error: 'Could not reopen the list. Please try again.' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_list_reopen_failed')).toMatchObject({
      after: { reason: 'update_failed', message: 'update boom' },
    });
  });
});

// ===========================================================================
// addCandidateFromGooglePlaces
// ===========================================================================

describe('addCandidateFromGooglePlaces', () => {
  it('happy path — fetches Place Details, INSERTs source=google_places, audits, revalidates', async () => {
    const { client, captured } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(client);
    getPlaceDetailsMock.mockResolvedValue(makePlaceResult());

    const { addCandidateFromGooglePlaces } = await import('./actions');
    const state = await addCandidateFromGooglePlaces({}, makeGooglePlacesFormData());

    expect(state).toEqual({
      ok: true,
      message: 'Candidate added.',
      candidateId: NEW_CANDIDATE_ID,
    });

    // Place Details fetched directly via the adapter — no Route Handler hop.
    expect(getPlaceDetailsMock).toHaveBeenCalledWith(PLACE_ID);

    expect(captured.candidateInsert).toHaveLength(1);
    expect(captured.candidateInsert[0]).toEqual({
      hotel_id: HOTEL_ID,
      source: 'google_places',
      google_place_id: PLACE_ID,
      name: 'Beachside Cafe',
      address: '1 Beach Rd, Sydney NSW',
      category: 'cafe', // derived from primaryType (no override)
      distance_m: null, // always null for a Google Places add
      phone: '(02) 1234 5678',
      website: 'https://beachside.example',
      proposed_by: STAFF_USER_ID,
      status: 'proposed',
    });

    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]');
    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]/candidates');

    expect(auditEntry('candidate_added')).toMatchObject({
      actor_role: 'strictons_staff',
      entity_type: 'candidate_businesses',
      entity_id: NEW_CANDIDATE_ID,
      entity_hotel_id: HOTEL_ID,
      after: { source: 'google_places', name: 'Beachside Cafe', google_place_id: PLACE_ID },
    });
  });

  it('uses the category override when supplied (wins over primaryType)', async () => {
    const { client, captured } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(client);
    getPlaceDetailsMock.mockResolvedValue(makePlaceResult({ primaryType: 'cafe' }));

    const { addCandidateFromGooglePlaces } = await import('./actions');
    await addCandidateFromGooglePlaces({}, makeGooglePlacesFormData({ category: 'restaurant' }));

    expect((captured.candidateInsert[0] as Record<string, unknown>).category).toBe('restaurant');
  });

  it('derives category from primaryType when no override; null when neither is present', async () => {
    const first = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(first.client);
    getPlaceDetailsMock.mockResolvedValue(makePlaceResult({ primaryType: 'bar' }));

    let actions = await import('./actions');
    await actions.addCandidateFromGooglePlaces({}, makeGooglePlacesFormData());
    expect((first.captured.candidateInsert[0] as Record<string, unknown>).category).toBe('bar');

    // Fresh module + client; Place Details with no primaryType → category null.
    vi.resetModules();
    const second = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(second.client);
    getPlaceDetailsMock.mockResolvedValue(makePlaceResult({ primaryType: undefined }));
    actions = await import('./actions');
    await actions.addCandidateFromGooglePlaces({}, makeGooglePlacesFormData());
    expect((second.captured.candidateInsert[0] as Record<string, unknown>).category).toBeNull();
  });

  it('rejects when caller is not staff (no service client, no adapter call, no audit)', async () => {
    requireStaffMock.mockResolvedValue({ kind: 'error', error: 'Not signed in.' });

    const { addCandidateFromGooglePlaces } = await import('./actions');
    const state = await addCandidateFromGooglePlaces({}, makeGooglePlacesFormData());

    expect(state).toEqual({ error: 'Not signed in.' });
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(getPlaceDetailsMock).not.toHaveBeenCalled();
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it('audits validation_failed for a missing placeId, before any adapter call', async () => {
    const { addCandidateFromGooglePlaces } = await import('./actions');
    const state = await addCandidateFromGooglePlaces({}, makeGooglePlacesFormData({ placeId: '' }));

    expect(state.error).toBe('Please fix the errors below.');
    expect(state.fieldErrors?.placeId).toBeDefined();
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(getPlaceDetailsMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_add_failed')).toMatchObject({
      after: { reason: 'validation_failed' },
    });
  });

  it('audits hotel_not_found and does NOT call the adapter when the hotel SELECT returns no row', async () => {
    const { client } = makeServiceClient({ hotelLookup: { data: null, error: null } });
    createServiceRoleClientMock.mockReturnValue(client);

    const { addCandidateFromGooglePlaces } = await import('./actions');
    const state = await addCandidateFromGooglePlaces({}, makeGooglePlacesFormData());

    expect(state).toEqual({ error: 'Hotel not found.' });
    // The hotel SELECT runs before the Google call to spare the API budget.
    expect(getPlaceDetailsMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_add_failed')).toMatchObject({
      after: { reason: 'hotel_not_found' },
    });
  });

  it('maps PlacesConfigError to audit reason missing_api_key', async () => {
    const { client } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(client);

    const { PlacesConfigError } = await import('@/lib/google-places');
    getPlaceDetailsMock.mockRejectedValue(
      new PlacesConfigError('GOOGLE_PLACES_API_KEY is not set.'),
    );

    const { addCandidateFromGooglePlaces } = await import('./actions');
    const state = await addCandidateFromGooglePlaces({}, makeGooglePlacesFormData());

    expect(state.error).toMatch(/not configured/i);
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_add_failed')).toMatchObject({
      after: { reason: 'missing_api_key' },
    });
  });

  it('maps a 404 PlacesUpstreamError to audit reason place_not_found', async () => {
    const { client } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(client);

    const { PlacesUpstreamError } = await import('@/lib/google-places');
    getPlaceDetailsMock.mockRejectedValue(
      new PlacesUpstreamError('Google Places API error: place not found', 404),
    );

    const { addCandidateFromGooglePlaces } = await import('./actions');
    const state = await addCandidateFromGooglePlaces({}, makeGooglePlacesFormData());

    expect(state.error).toMatch(/could not be found/i);
    expect(auditEntry('candidate_add_failed')).toMatchObject({
      after: { reason: 'place_not_found' },
    });
  });

  it('maps a non-404 PlacesUpstreamError to audit reason places_api_failed', async () => {
    const { client } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(client);

    const { PlacesUpstreamError } = await import('@/lib/google-places');
    getPlaceDetailsMock.mockRejectedValue(
      new PlacesUpstreamError('Google Places request timed out after 8000ms.'),
    );

    const { addCandidateFromGooglePlaces } = await import('./actions');
    const state = await addCandidateFromGooglePlaces({}, makeGooglePlacesFormData());

    expect(state.error).toMatch(/could not reach google places/i);
    expect(auditEntry('candidate_add_failed')).toMatchObject({
      after: { reason: 'places_api_failed' },
    });
  });

  it('maps a Postgres 23505 unique violation to duplicate_place + fieldErrors.placeId', async () => {
    const { client } = makeServiceClient({
      candidateInsert: {
        data: null,
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "candidate_businesses_hotel_place_alive_uidx"',
        },
      },
    });
    createServiceRoleClientMock.mockReturnValue(client);
    getPlaceDetailsMock.mockResolvedValue(makePlaceResult());

    const { addCandidateFromGooglePlaces } = await import('./actions');
    const state = await addCandidateFromGooglePlaces({}, makeGooglePlacesFormData());

    expect(state.ok).toBeUndefined();
    expect(state.fieldErrors?.placeId).toContain('already on the candidate list');
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_add_failed')).toMatchObject({
      after: { reason: 'duplicate_place', google_place_id: PLACE_ID },
    });
  });

  it('audits insert_failed for a non-23505 INSERT error', async () => {
    const { client } = makeServiceClient({
      candidateInsert: { data: null, error: { code: '23502', message: 'insert boom' } },
    });
    createServiceRoleClientMock.mockReturnValue(client);
    getPlaceDetailsMock.mockResolvedValue(makePlaceResult());

    const { addCandidateFromGooglePlaces } = await import('./actions');
    const state = await addCandidateFromGooglePlaces({}, makeGooglePlacesFormData());

    expect(state).toEqual({ error: 'Could not add candidate. Please try again.' });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_add_failed')).toMatchObject({
      after: { reason: 'insert_failed', message: 'insert boom' },
    });
  });
});

// ===========================================================================
// uploadCandidateCsv
// ===========================================================================

describe('uploadCandidateCsv', () => {
  it('happy path — batch-INSERTs the valid rows, audits candidate_csv_imported, revalidates', async () => {
    const { client, captured } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(client);
    parseCandidatesCsvMock.mockReturnValue({
      ok: true,
      rows: [
        { name: 'Cafe One', website: 'https://one.example' },
        { name: 'Cafe Two', distance_m: 200 },
        { name: 'Cafe Three' },
      ],
      rejected: [],
    });

    const { uploadCandidateCsv } = await import('./actions');
    const state = await uploadCandidateCsv({}, makeCsvFormData());

    expect(state).toEqual({
      ok: true,
      message: 'Imported 3 candidates.',
      importedCount: 3,
      rejectedCount: 0,
      rejected: [],
    });

    // A single batch INSERT of the array of payloads.
    expect(captured.candidateInsert).toHaveLength(1);
    const payloads = captured.candidateInsert[0] as Record<string, unknown>[];
    expect(payloads).toHaveLength(3);
    for (const payload of payloads) {
      expect(payload.hotel_id).toBe(HOTEL_ID);
      expect(payload.source).toBe('csv');
      expect(payload.proposed_by).toBe(STAFF_USER_ID);
      expect(payload.status).toBe('proposed');
    }
    // undefined optional fields map to null.
    expect(payloads[2]).toMatchObject({
      name: 'Cafe Three',
      address: null,
      category: null,
      distance_m: null,
      phone: null,
      website: null,
      contact_email: null,
    });

    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]');
    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]/candidates');

    expect(auditEntry('candidate_csv_imported')).toMatchObject({
      actor_role: 'strictons_staff',
      entity_type: 'candidate_businesses',
      entity_hotel_id: HOTEL_ID,
      after: { imported: 3, rejected: 0 },
    });
  });

  it('mixed — 2 valid + 1 invalid → success partial with the rejected list', async () => {
    const { client } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(client);
    parseCandidatesCsvMock.mockReturnValue({
      ok: true,
      rows: [{ name: 'Cafe One' }, { name: 'Cafe Two' }],
      rejected: [{ rowNumber: 4, error: 'website: Invalid URL' }],
    });

    const { uploadCandidateCsv } = await import('./actions');
    const state = await uploadCandidateCsv({}, makeCsvFormData());

    expect(state).toEqual({
      ok: true,
      message: 'Imported 2 candidates; 1 rows had errors and were skipped.',
      importedCount: 2,
      rejectedCount: 1,
      rejected: [{ rowNumber: 4, error: 'website: Invalid URL' }],
    });
    expect(auditEntry('candidate_csv_imported')).toMatchObject({
      after: { imported: 2, rejected: 1 },
    });
  });

  it('all-rejection — 0 valid rows is success with N=0, and the batch INSERT is skipped', async () => {
    const { client, captured } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(client);
    parseCandidatesCsvMock.mockReturnValue({
      ok: true,
      rows: [],
      rejected: [
        { rowNumber: 2, error: 'name: Too small' },
        { rowNumber: 3, error: 'name: Too small' },
        { rowNumber: 4, error: 'website: Invalid URL' },
      ],
    });

    const { uploadCandidateCsv } = await import('./actions');
    const state = await uploadCandidateCsv({}, makeCsvFormData());

    expect(state).toEqual({
      ok: true,
      message: 'Imported 0 candidates; 3 rows had errors and were skipped.',
      importedCount: 0,
      rejectedCount: 3,
      rejected: [
        { rowNumber: 2, error: 'name: Too small' },
        { rowNumber: 3, error: 'name: Too small' },
        { rowNumber: 4, error: 'website: Invalid URL' },
      ],
    });
    // Nothing to insert — the batch INSERT is skipped entirely.
    expect(captured.candidateInsert).toHaveLength(0);
    expect(auditEntry('candidate_csv_imported')).toMatchObject({
      after: { imported: 0, rejected: 3 },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]/candidates');
  });

  it('rejects when caller is not staff (no service client, no parse, no audit)', async () => {
    requireStaffMock.mockResolvedValue({ kind: 'error', error: 'Not signed in.' });

    const { uploadCandidateCsv } = await import('./actions');
    const state = await uploadCandidateCsv({}, makeCsvFormData());

    expect(state).toEqual({ error: 'Not signed in.' });
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(parseCandidatesCsvMock).not.toHaveBeenCalled();
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it('audits validation_failed for a malformed hotelId, before any parse', async () => {
    const { uploadCandidateCsv } = await import('./actions');
    const state = await uploadCandidateCsv({}, makeCsvFormData({ hotelId: 'not-a-uuid' }));

    expect(state).toEqual({ error: 'Invalid request.', rejected: [] });
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(parseCandidatesCsvMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_csv_import_failed')).toMatchObject({
      after: { reason: 'validation_failed' },
    });
  });

  it('audits validation_failed when no file is provided', async () => {
    const { uploadCandidateCsv } = await import('./actions');
    const state = await uploadCandidateCsv({}, makeCsvFormData({ file: null }));

    expect(state).toEqual({ error: 'Please choose a CSV file to upload.', rejected: [] });
    expect(parseCandidatesCsvMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_csv_import_failed')).toMatchObject({
      after: { reason: 'validation_failed' },
    });
  });

  it('audits validation_failed when the file entry is not a File', async () => {
    const { uploadCandidateCsv } = await import('./actions');
    const state = await uploadCandidateCsv({}, makeCsvFormData({ file: 'just-a-string' }));

    expect(state).toEqual({ error: 'Please choose a CSV file to upload.', rejected: [] });
    expect(parseCandidatesCsvMock).not.toHaveBeenCalled();
  });

  it('audits hotel_not_found and does NOT parse when the hotel SELECT returns no row', async () => {
    const { client } = makeServiceClient({ hotelLookup: { data: null, error: null } });
    createServiceRoleClientMock.mockReturnValue(client);

    const { uploadCandidateCsv } = await import('./actions');
    const state = await uploadCandidateCsv({}, makeCsvFormData());

    expect(state).toEqual({ error: 'Hotel not found.', rejected: [] });
    expect(parseCandidatesCsvMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_csv_import_failed')).toMatchObject({
      after: { reason: 'hotel_not_found' },
    });
  });

  it.each([
    ['oversized', 'oversized', 'The CSV file is too large. The maximum size is 1 MB.'],
    ['too_many_rows', 'too_many_rows', 'The CSV has 501 data rows. The maximum is 500.'],
    [
      'missing_name_column',
      'missing_name_column',
      "The CSV is missing the required 'name' column.",
    ],
    ['empty', 'parse_failed', 'The CSV file is empty.'],
    ['no_data_rows', 'parse_failed', 'The CSV has no data rows.'],
    ['parse_failed', 'parse_failed', 'The CSV could not be parsed.'],
  ])('maps parser fatal reason %s to audit reason %s', async (parserReason, auditReason, error) => {
    const { client } = makeServiceClient();
    createServiceRoleClientMock.mockReturnValue(client);
    parseCandidatesCsvMock.mockReturnValue({ ok: false, error, reason: parserReason });

    const { uploadCandidateCsv } = await import('./actions');
    const state = await uploadCandidateCsv({}, makeCsvFormData());

    expect(state).toEqual({ error, rejected: [] });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_csv_import_failed')).toMatchObject({
      entity_hotel_id: HOTEL_ID,
      after: { reason: auditReason, message: error },
    });
  });

  it('audits insert_failed when the batch INSERT errors — the parser rejections still surface', async () => {
    const { client } = makeServiceClient({
      candidateBatchInsert: { data: null, error: { message: 'batch insert boom' } },
    });
    createServiceRoleClientMock.mockReturnValue(client);
    parseCandidatesCsvMock.mockReturnValue({
      ok: true,
      rows: [{ name: 'Cafe One' }, { name: 'Cafe Two' }],
      rejected: [{ rowNumber: 5, error: 'contact_email: Invalid email' }],
    });

    const { uploadCandidateCsv } = await import('./actions');
    const state = await uploadCandidateCsv({}, makeCsvFormData());

    expect(state).toEqual({
      error: 'Import failed; no rows inserted.',
      rejected: [{ rowNumber: 5, error: 'contact_email: Invalid email' }],
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(auditEntry('candidate_csv_import_failed')).toMatchObject({
      after: { reason: 'insert_failed', message: 'batch insert boom' },
    });
  });
});
