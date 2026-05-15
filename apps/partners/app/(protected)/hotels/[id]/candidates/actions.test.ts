import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 6 commit 9 — partners-side (hotel-admin) candidate-list
 * Server Action tests. Mirrors apps/admin/.../candidates/actions.test.ts
 * in shape; differences:
 *
 *   - Mocks @strictons/db/server (createServerClient, cookie-based)
 *     rather than @strictons/db/client (createServiceRoleClient).
 *   - Mocks @strictons/db/roles (getMembershipSet) for the auth +
 *     hotel-admin scope check.
 *   - actor_role on every audit assertion is 'hotel_admin'.
 *   - Status on hotel-side removals is 'removed_by_hotel' (not
 *     'removed_by_strictons').
 *
 * Mock surface is intentionally narrow: the supabase chain stub returns
 * canned data for from().select().eq().maybeSingle(), .insert(), and
 * .update().eq(). The cookie-based client's auth.getUser() returns the
 * `user` opt. RLS is NOT exercised here — these unit tests cover the
 * action-layer logic (precondition checks, audit reasons, return
 * shapes). RLS is covered by the migration-15 pgTAP suite (commit 1).
 */

// ---- Mocks for the action's dependencies ----------------------------------

const createServerClientMock = vi.fn();
const getMembershipSetMock = vi.fn();
const writeAuditLogMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock('@strictons/db/server', () => ({
  createServerClient: () => createServerClientMock(),
}));
vi.mock('@strictons/db/roles', () => ({
  getMembershipSet: (...args: unknown[]) => getMembershipSetMock(...args),
}));
vi.mock('@strictons/db/audit', () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLogMock(...args),
}));
// next/cache requires a Next request context (static generation store).
// Mocked here; the real revalidation behaviour is covered by the
// cross-app Playwright E2E (commit 11).
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

// ---- Test fixtures --------------------------------------------------------

const HOTEL_ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const HOTEL_ADMIN_EMAIL = 'hotel-admin@example.test';
const HOTEL_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_HOTEL_ID = '33333333-3333-4333-9333-333333333333';
const CANDIDATE_ID = '44444444-4444-4444-a444-444444444444';
const NEW_CANDIDATE_ID = '55555555-5555-4555-8555-555555555555';

/**
 * Build a supabase chain stub for the cookie-based client.
 *
 * Per-table response routing: hotelLookupResponse / candidateLookupResponse
 * are returned by from(table).select().eq().maybeSingle() based on the
 * table name. insertResponse / updateResponse cover the mutation paths.
 * Captures the inserted / updated payload + filter-key on stub for
 * assertion.
 */
type ChainStub = {
  insertedPayload?: unknown;
  insertedTable?: string;
  updatedPayload?: unknown;
  updatedTable?: string;
  updateFilterValue?: unknown;
};

function makeSupabase(opts: {
  user: { id: string; email: string } | null;
  hotelLookupResponse?: { data: unknown; error: unknown };
  candidateLookupResponse?: { data: unknown; error: unknown };
  insertResponse?: { data: unknown; error: unknown };
  updateResponse?: { data: unknown; error: unknown };
}) {
  const stub: ChainStub = {};
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: opts.user }, error: null }),
    },
    from: vi.fn((table: string) => {
      const builder = {
        insert: vi.fn((payload: unknown) => {
          stub.insertedPayload = payload;
          stub.insertedTable = table;
          return {
            select: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve(
                  opts.insertResponse ?? {
                    data: { id: NEW_CANDIDATE_ID },
                    error: null,
                  },
                ),
              ),
            })),
          };
        }),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => {
              const resp =
                table === 'hotels' ? opts.hotelLookupResponse : opts.candidateLookupResponse;
              return Promise.resolve(resp ?? { data: null, error: null });
            }),
          })),
        })),
        update: vi.fn((payload: unknown) => {
          stub.updatedPayload = payload;
          stub.updatedTable = table;
          return {
            eq: vi.fn((_col: string, value: unknown) => {
              stub.updateFilterValue = value;
              return Promise.resolve(opts.updateResponse ?? { data: null, error: null });
            }),
          };
        }),
      };
      return builder;
    }),
  };
  return { supabase, stub };
}

function membershipSet(opts: { hotelIds: string[]; isStaff?: boolean }) {
  return {
    userId: HOTEL_ADMIN_USER_ID,
    email: HOTEL_ADMIN_EMAIL,
    isStrictonsStaff: opts.isStaff ?? false,
    roles: opts.hotelIds.map((id) => ({
      kind: 'hotel_admin' as const,
      hotelId: id,
      hotelSlug: `slug-${id.slice(0, 4)}`,
      hotelName: `Hotel ${id.slice(0, 4)}`,
    })),
  };
}

function setUpAdminOf(hotelId: string, supabase: ReturnType<typeof makeSupabase>['supabase']) {
  createServerClientMock.mockResolvedValue(supabase);
  getMembershipSetMock.mockResolvedValue(membershipSet({ hotelIds: [hotelId] }));
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  createServerClientMock.mockReset();
  getMembershipSetMock.mockReset();
  writeAuditLogMock.mockReset();
  writeAuditLogMock.mockResolvedValue(undefined);
  revalidatePathMock.mockReset();
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function findAudit(action: string): Record<string, unknown> | undefined {
  for (const call of writeAuditLogMock.mock.calls) {
    const entry = call[0] as Record<string, unknown>;
    if (entry.action === action) return entry;
  }
  return undefined;
}

// ===========================================================================
// addCandidateManualHotel
// ===========================================================================

describe('addCandidateManualHotel', () => {
  it('inserts a manual candidate when the list is with_hotel and audits candidate_added', async () => {
    const { supabase, stub } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_with_hotel' },
        error: null,
      },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { addCandidateManualHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('name', 'Hotel-Added Cafe');

    const result = await addCandidateManualHotel({}, fd);

    expect(result).toEqual({
      ok: true,
      message: 'Candidate added.',
      candidateId: NEW_CANDIDATE_ID,
    });
    expect(stub.insertedTable).toBe('candidate_businesses');
    expect(stub.insertedPayload).toMatchObject({
      hotel_id: HOTEL_ID,
      source: 'manual',
      name: 'Hotel-Added Cafe',
      proposed_by: HOTEL_ADMIN_USER_ID,
      status: 'proposed',
    });
    const audit = findAudit('candidate_added');
    expect(audit).toBeDefined();
    expect(audit?.actor_role).toBe('hotel_admin');
    expect(audit?.actor_user_id).toBe(HOTEL_ADMIN_USER_ID);
    expect(audit?.entity_hotel_id).toBe(HOTEL_ID);
    expect(audit?.after).toMatchObject({
      source: 'manual',
      name: 'Hotel-Added Cafe',
      proposed_by_hotel: true,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]');
    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]/candidates');
  });

  it('allows insert when the list is paused_awaiting_hotel_response', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'paused_awaiting_hotel_response' },
        error: null,
      },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { addCandidateManualHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('name', 'Paused-State Cafe');

    const result = await addCandidateManualHotel({}, fd);
    expect(result.ok).toBe(true);
    expect(findAudit('candidate_added')).toBeDefined();
  });

  it('rejects when not signed in', async () => {
    const { supabase } = makeSupabase({ user: null });
    createServerClientMock.mockResolvedValue(supabase);

    const { addCandidateManualHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('name', 'Test');

    const result = await addCandidateManualHotel({}, fd);
    expect(result.error).toMatch(/Not signed in/);
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it('audits validation_failed on a malformed hotelId', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
    });
    createServerClientMock.mockResolvedValue(supabase);
    getMembershipSetMock.mockResolvedValue(membershipSet({ hotelIds: [HOTEL_ID] }));

    const { addCandidateManualHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', 'not-a-uuid');
    fd.set('name', 'Test');

    const result = await addCandidateManualHotel({}, fd);
    expect(result.error).toMatch(/fix the errors/i);
    expect(result.fieldErrors?.hotelId).toBeDefined();
    const audit = findAudit('candidate_add_failed');
    expect(audit).toBeDefined();
    expect((audit?.after as Record<string, unknown>).reason).toBe('validation_failed');
    expect(audit?.entity_hotel_id).toBeNull();
  });

  it('rejects a caller who admins a different hotel', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
    });
    createServerClientMock.mockResolvedValue(supabase);
    getMembershipSetMock.mockResolvedValue(membershipSet({ hotelIds: [OTHER_HOTEL_ID] }));

    const { addCandidateManualHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('name', 'Test');

    const result = await addCandidateManualHotel({}, fd);
    expect(result.error).toMatch(/do not admin/i);
    // No audit row on a scope mismatch — middleware already gated the
    // route; scope mismatch on a UUID-valid id is most often a stale
    // form post (consistent with admin-side requireStaff pattern).
    expect(findAudit('candidate_add_failed')).toBeUndefined();
  });

  it('audits hotel_not_found with entity_hotel_id=null when the hotel SELECT misses', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: { data: null, error: null },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { addCandidateManualHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('name', 'Test');

    const result = await addCandidateManualHotel({}, fd);
    expect(result.error).toMatch(/Hotel not found/);
    const audit = findAudit('candidate_add_failed');
    expect((audit?.after as Record<string, unknown>).reason).toBe('hotel_not_found');
    expect(audit?.entity_hotel_id).toBeNull();
  });

  it('audits list_not_editable when approval_state is candidate_list_drafted', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_drafted' },
        error: null,
      },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { addCandidateManualHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('name', 'Test');

    const result = await addCandidateManualHotel({}, fd);
    expect(result.error).toMatch(/not open for hotel edits/i);
    const audit = findAudit('candidate_add_failed');
    expect((audit?.after as Record<string, unknown>).reason).toBe('list_not_editable');
    expect(audit?.entity_hotel_id).toBe(HOTEL_ID);
  });

  it('audits list_not_editable when approval_state is candidate_list_approved', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_approved' },
        error: null,
      },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { addCandidateManualHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('name', 'Test');

    const result = await addCandidateManualHotel({}, fd);
    expect(result.error).toMatch(/not open for hotel edits/i);
    expect((findAudit('candidate_add_failed')?.after as Record<string, unknown>).reason).toBe(
      'list_not_editable',
    );
  });

  it('audits insert_failed when the INSERT errors (e.g. RLS denies)', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_with_hotel' },
        error: null,
      },
      insertResponse: { data: null, error: { message: 'new row violates RLS' } },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { addCandidateManualHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('name', 'Test');

    const result = await addCandidateManualHotel({}, fd);
    expect(result.error).toMatch(/Could not add/);
    const audit = findAudit('candidate_add_failed');
    expect((audit?.after as Record<string, unknown>).reason).toBe('insert_failed');
    expect(audit?.entity_hotel_id).toBe(HOTEL_ID);
  });
});

// ===========================================================================
// removeCandidateAsHotel
// ===========================================================================

describe('removeCandidateAsHotel', () => {
  it('soft-deletes a candidate with status=removed_by_hotel and audits candidate_removed', async () => {
    const { supabase, stub } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_with_hotel' },
        error: null,
      },
      candidateLookupResponse: {
        data: { id: CANDIDATE_ID, hotel_id: HOTEL_ID, removed_at: null },
        error: null,
      },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { removeCandidateAsHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('candidateId', CANDIDATE_ID);
    fd.set('reason', 'not a good fit');

    const result = await removeCandidateAsHotel({}, fd);

    expect(result).toEqual({ ok: true, message: 'Candidate removed.' });
    expect(stub.updatedTable).toBe('candidate_businesses');
    expect(stub.updatedPayload).toMatchObject({
      status: 'removed_by_hotel',
      removed_by: HOTEL_ADMIN_USER_ID,
      removal_reason: 'not a good fit',
    });
    // removed_at is a JS-side ISO string; the action audits the same
    // value, so cross-check rather than asserting an exact instant.
    const payload = stub.updatedPayload as Record<string, unknown>;
    expect(typeof payload.removed_at).toBe('string');

    const audit = findAudit('candidate_removed');
    expect(audit?.actor_role).toBe('hotel_admin');
    expect(audit?.entity_id).toBe(CANDIDATE_ID);
    expect(audit?.entity_hotel_id).toBe(HOTEL_ID);
    expect(audit?.after).toMatchObject({
      reason: 'not a good fit',
      status: 'removed_by_hotel',
    });
  });

  it('removes without a reason (reason is optional)', async () => {
    const { supabase, stub } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_with_hotel' },
        error: null,
      },
      candidateLookupResponse: {
        data: { id: CANDIDATE_ID, hotel_id: HOTEL_ID, removed_at: null },
        error: null,
      },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { removeCandidateAsHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('candidateId', CANDIDATE_ID);

    const result = await removeCandidateAsHotel({}, fd);
    expect(result.ok).toBe(true);
    expect((stub.updatedPayload as Record<string, unknown>).removal_reason).toBeNull();
    expect((findAudit('candidate_removed')?.after as Record<string, unknown>).reason).toBeNull();
  });

  it('audits validation_failed on a malformed candidateId', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
    });
    createServerClientMock.mockResolvedValue(supabase);
    getMembershipSetMock.mockResolvedValue(membershipSet({ hotelIds: [HOTEL_ID] }));

    const { removeCandidateAsHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('candidateId', 'not-a-uuid');

    const result = await removeCandidateAsHotel({}, fd);
    expect(result.error).toMatch(/Invalid/);
    expect((findAudit('candidate_remove_failed')?.after as Record<string, unknown>).reason).toBe(
      'validation_failed',
    );
  });

  it('audits hotel_not_found when the hotel SELECT misses', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: { data: null, error: null },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { removeCandidateAsHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('candidateId', CANDIDATE_ID);

    const result = await removeCandidateAsHotel({}, fd);
    expect(result.error).toMatch(/Hotel not found/);
    const audit = findAudit('candidate_remove_failed');
    expect((audit?.after as Record<string, unknown>).reason).toBe('hotel_not_found');
    expect(audit?.entity_hotel_id).toBeNull();
  });

  it('audits list_not_editable when the hotel is in candidate_list_drafted', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_drafted' },
        error: null,
      },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { removeCandidateAsHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('candidateId', CANDIDATE_ID);

    const result = await removeCandidateAsHotel({}, fd);
    expect(result.error).toMatch(/not open for hotel edits/i);
    expect((findAudit('candidate_remove_failed')?.after as Record<string, unknown>).reason).toBe(
      'list_not_editable',
    );
  });

  it('audits not_found when the candidate SELECT misses', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_with_hotel' },
        error: null,
      },
      candidateLookupResponse: { data: null, error: null },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { removeCandidateAsHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('candidateId', CANDIDATE_ID);

    const result = await removeCandidateAsHotel({}, fd);
    expect(result.error).toMatch(/Candidate not found/);
    expect((findAudit('candidate_remove_failed')?.after as Record<string, unknown>).reason).toBe(
      'not_found',
    );
  });

  it('audits cross_hotel_smuggling when candidate belongs to a different hotel', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_with_hotel' },
        error: null,
      },
      candidateLookupResponse: {
        data: { id: CANDIDATE_ID, hotel_id: OTHER_HOTEL_ID, removed_at: null },
        error: null,
      },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { removeCandidateAsHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('candidateId', CANDIDATE_ID);

    const result = await removeCandidateAsHotel({}, fd);
    // User-facing message intentionally identical to not_found so the
    // existence of the other hotel's row isn't leaked.
    expect(result.error).toMatch(/Candidate not found/);
    const audit = findAudit('candidate_remove_failed');
    expect((audit?.after as Record<string, unknown>).reason).toBe('cross_hotel_smuggling');
    expect((audit?.after as Record<string, unknown>).actual_hotel_id).toBe(OTHER_HOTEL_ID);
  });

  it('audits already_removed when the candidate is already soft-deleted', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_with_hotel' },
        error: null,
      },
      candidateLookupResponse: {
        data: {
          id: CANDIDATE_ID,
          hotel_id: HOTEL_ID,
          removed_at: '2026-05-01T00:00:00.000Z',
        },
        error: null,
      },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { removeCandidateAsHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('candidateId', CANDIDATE_ID);

    const result = await removeCandidateAsHotel({}, fd);
    expect(result.error).toMatch(/already been removed/);
    expect((findAudit('candidate_remove_failed')?.after as Record<string, unknown>).reason).toBe(
      'already_removed',
    );
  });

  it('audits update_failed when the soft-delete UPDATE errors', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_with_hotel' },
        error: null,
      },
      candidateLookupResponse: {
        data: { id: CANDIDATE_ID, hotel_id: HOTEL_ID, removed_at: null },
        error: null,
      },
      updateResponse: { data: null, error: { message: 'update denied' } },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { removeCandidateAsHotel } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);
    fd.set('candidateId', CANDIDATE_ID);

    const result = await removeCandidateAsHotel({}, fd);
    expect(result.error).toMatch(/Could not remove/);
    expect((findAudit('candidate_remove_failed')?.after as Record<string, unknown>).reason).toBe(
      'update_failed',
    );
  });
});

// ===========================================================================
// approveCandidateList
// ===========================================================================

describe('approveCandidateList', () => {
  it('approves the list when state is candidate_list_with_hotel', async () => {
    const { supabase, stub } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_with_hotel' },
        error: null,
      },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { approveCandidateList } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);

    const result = await approveCandidateList({}, fd);

    expect(result).toEqual({ ok: true, message: 'Candidate list approved.' });
    expect(stub.updatedTable).toBe('hotels');
    expect(stub.updatedPayload).toMatchObject({
      approval_state: 'candidate_list_approved',
    });
    const payload = stub.updatedPayload as Record<string, unknown>;
    expect(typeof payload.candidate_list_approved_at).toBe('string');

    const audit = findAudit('candidate_list_approved');
    expect(audit?.actor_role).toBe('hotel_admin');
    expect(audit?.entity_type).toBe('hotels');
    expect(audit?.entity_id).toBe(HOTEL_ID);
    expect(audit?.entity_hotel_id).toBe(HOTEL_ID);
    expect((audit?.after as Record<string, unknown>).approved_at).toEqual(
      payload.candidate_list_approved_at,
    );
  });

  it('audits validation_failed on a malformed hotelId (§8 commit-9 extension)', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
    });
    createServerClientMock.mockResolvedValue(supabase);
    getMembershipSetMock.mockResolvedValue(membershipSet({ hotelIds: [HOTEL_ID] }));

    const { approveCandidateList } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', 'not-a-uuid');

    const result = await approveCandidateList({}, fd);
    expect(result.error).toMatch(/Invalid/);
    const audit = findAudit('candidate_list_approve_failed');
    expect((audit?.after as Record<string, unknown>).reason).toBe('validation_failed');
    expect(audit?.entity_hotel_id).toBeNull();
  });

  it('audits hotel_not_found when the SELECT misses (§8 commit-9 extension)', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: { data: null, error: null },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { approveCandidateList } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);

    const result = await approveCandidateList({}, fd);
    expect(result.error).toMatch(/Hotel not found/);
    const audit = findAudit('candidate_list_approve_failed');
    expect((audit?.after as Record<string, unknown>).reason).toBe('hotel_not_found');
    expect(audit?.entity_hotel_id).toBeNull();
  });

  it('audits wrong_state when approval_state is candidate_list_drafted', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_drafted' },
        error: null,
      },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { approveCandidateList } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);

    const result = await approveCandidateList({}, fd);
    expect(result.error).toMatch(/not currently with the hotel/i);
    const audit = findAudit('candidate_list_approve_failed');
    expect((audit?.after as Record<string, unknown>).reason).toBe('wrong_state');
  });

  it('audits wrong_state when approval_state is paused_awaiting_hotel_response', async () => {
    // paused_awaiting_hotel_response permits add/remove but NOT approve
    // — approval is a one-way transition out of with_hotel only.
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'paused_awaiting_hotel_response' },
        error: null,
      },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { approveCandidateList } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);

    const result = await approveCandidateList({}, fd);
    expect(result.error).toMatch(/not currently with the hotel/i);
    expect(
      (findAudit('candidate_list_approve_failed')?.after as Record<string, unknown>).reason,
    ).toBe('wrong_state');
  });

  it('audits update_failed when the UPDATE errors', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
      hotelLookupResponse: {
        data: { id: HOTEL_ID, approval_state: 'candidate_list_with_hotel' },
        error: null,
      },
      updateResponse: { data: null, error: { message: 'trigger raised' } },
    });
    setUpAdminOf(HOTEL_ID, supabase);

    const { approveCandidateList } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);

    const result = await approveCandidateList({}, fd);
    expect(result.error).toMatch(/Could not approve/);
    expect(
      (findAudit('candidate_list_approve_failed')?.after as Record<string, unknown>).reason,
    ).toBe('update_failed');
  });

  it('rejects a caller who admins a different hotel', async () => {
    const { supabase } = makeSupabase({
      user: { id: HOTEL_ADMIN_USER_ID, email: HOTEL_ADMIN_EMAIL },
    });
    createServerClientMock.mockResolvedValue(supabase);
    getMembershipSetMock.mockResolvedValue(membershipSet({ hotelIds: [OTHER_HOTEL_ID] }));

    const { approveCandidateList } = await import('./actions');
    const fd = new FormData();
    fd.set('hotelId', HOTEL_ID);

    const result = await approveCandidateList({}, fd);
    expect(result.error).toMatch(/do not admin/i);
    expect(findAudit('candidate_list_approve_failed')).toBeUndefined();
  });
});
