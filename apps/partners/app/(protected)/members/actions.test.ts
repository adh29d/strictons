import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
// Vitest doesn't run inside that context, so calling revalidatePath
// from a Server Action under test throws "Invariant: static generation
// store missing". Mock it for the unit tests; the real revalidation
// behaviour is exercised by the Playwright E2E in
// apps/partners/e2e/invite-revoke.spec.ts.
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

// ---- Test helpers ---------------------------------------------------------

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_EMAIL = 'admin@example.test';
const HOTEL_ID = '22222222-2222-4222-8222-222222222222';
const BUSINESS_ID = '33333333-3333-4333-9333-333333333333';
const NEW_MEMBERSHIP_ID = '44444444-4444-4444-a444-444444444444';
const OTHER_HOTEL_ID = '55555555-5555-4555-8555-555555555555';

type SupabaseChainStub = {
  insertedPayload?: unknown;
  insertResponse?: { data: unknown; error: unknown };
  updatedPayload?: unknown;
  updateResponse?: { data: unknown; error: unknown };
  lookupResponse?: { data: unknown; error: unknown };
};

function makeSupabase(opts: {
  user: { id: string; email: string } | null;
  insertResponse?: { data: unknown; error: unknown };
  lookupResponse?: { data: unknown; error: unknown };
  updateResponse?: { data: unknown; error: unknown };
}) {
  const stub: SupabaseChainStub = {};
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: opts.user }, error: null }),
    },
    from: vi.fn(() => {
      const builder = {
        insert: vi.fn((payload: unknown) => {
          stub.insertedPayload = payload;
          return {
            select: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve(
                  opts.insertResponse ?? {
                    data: { id: NEW_MEMBERSHIP_ID },
                    error: null,
                  },
                ),
              ),
            })),
          };
        }),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() =>
              Promise.resolve(opts.lookupResponse ?? { data: null, error: null }),
            ),
          })),
        })),
        update: vi.fn((payload: unknown) => {
          stub.updatedPayload = payload;
          return {
            eq: vi.fn(() => Promise.resolve(opts.updateResponse ?? { data: null, error: null })),
          };
        }),
      };
      return builder;
    }),
  };
  return { supabase, stub };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  createServerClientMock.mockReset();
  getMembershipSetMock.mockReset();
  writeAuditLogMock.mockReset();
  writeAuditLogMock.mockResolvedValue(undefined);
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ---- inviteHotelMember ----------------------------------------------------

describe('inviteHotelMember', () => {
  it('parses input, INSERTs into hotel_users, audit-logs invite_issued', async () => {
    const { supabase, stub } = makeSupabase({
      user: { id: ADMIN_USER_ID, email: ADMIN_EMAIL },
    });
    createServerClientMock.mockResolvedValue(supabase);
    getMembershipSetMock.mockResolvedValue({
      userId: ADMIN_USER_ID,
      email: ADMIN_EMAIL,
      isStrictonsStaff: false,
      roles: [
        {
          kind: 'hotel_admin',
          hotelId: HOTEL_ID,
          hotelSlug: 'alpha',
          hotelName: 'Alpha Hotel',
        },
      ],
    });

    const { inviteHotelMember } = await import('./actions');
    const fd = new FormData();
    fd.set('email', 'newbie@example.test');
    fd.set('hotelId', HOTEL_ID);

    const result = await inviteHotelMember({}, fd);

    expect(result).toEqual({ ok: true });
    expect(supabase.from).toHaveBeenCalledWith('hotel_users');
    expect(stub.insertedPayload).toEqual({
      hotel_id: HOTEL_ID,
      invited_email: 'newbie@example.test',
      invited_by: ADMIN_USER_ID,
    });

    expect(writeAuditLogMock).toHaveBeenCalledTimes(1);
    const auditEntry = writeAuditLogMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(auditEntry.action).toBe('invite_issued');
    expect(auditEntry.actor_role).toBe('hotel_admin');
    expect(auditEntry.actor_user_id).toBe(ADMIN_USER_ID);
    expect(auditEntry.entity_type).toBe('hotel_users');
    expect(auditEntry.entity_id).toBe(NEW_MEMBERSHIP_ID);
    expect(auditEntry.entity_hotel_id).toBe(HOTEL_ID);
  });

  it('rejects an invalid email with a user-safe error', async () => {
    const { inviteHotelMember } = await import('./actions');
    const fd = new FormData();
    fd.set('email', 'not-an-email');
    fd.set('hotelId', HOTEL_ID);

    const result = await inviteHotelMember({}, fd);

    expect(result.error).toMatch(/valid email/);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller', async () => {
    const { supabase } = makeSupabase({ user: null });
    createServerClientMock.mockResolvedValue(supabase);

    const { inviteHotelMember } = await import('./actions');
    const fd = new FormData();
    fd.set('email', 'newbie@example.test');
    fd.set('hotelId', HOTEL_ID);

    const result = await inviteHotelMember({}, fd);
    expect(result.error).toMatch(/Not signed in/);
  });

  it('rejects a non-admin caller (admin of a different hotel)', async () => {
    const { supabase } = makeSupabase({
      user: { id: ADMIN_USER_ID, email: ADMIN_EMAIL },
    });
    createServerClientMock.mockResolvedValue(supabase);
    getMembershipSetMock.mockResolvedValue({
      userId: ADMIN_USER_ID,
      email: ADMIN_EMAIL,
      isStrictonsStaff: false,
      roles: [
        {
          kind: 'hotel_admin',
          hotelId: OTHER_HOTEL_ID,
          hotelSlug: 'other',
          hotelName: 'Other Hotel',
        },
      ],
    });

    const { inviteHotelMember } = await import('./actions');
    const fd = new FormData();
    fd.set('email', 'newbie@example.test');
    fd.set('hotelId', HOTEL_ID);

    const result = await inviteHotelMember({}, fd);
    expect(result.error).toMatch(/do not admin/i);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('audit-logs invite_failed when the INSERT errors', async () => {
    const { supabase } = makeSupabase({
      user: { id: ADMIN_USER_ID, email: ADMIN_EMAIL },
      insertResponse: { data: null, error: { message: 'rls denied' } },
    });
    createServerClientMock.mockResolvedValue(supabase);
    getMembershipSetMock.mockResolvedValue({
      userId: ADMIN_USER_ID,
      email: ADMIN_EMAIL,
      isStrictonsStaff: false,
      roles: [
        {
          kind: 'hotel_admin',
          hotelId: HOTEL_ID,
          hotelSlug: 'alpha',
          hotelName: 'Alpha Hotel',
        },
      ],
    });

    const { inviteHotelMember } = await import('./actions');
    const fd = new FormData();
    fd.set('email', 'newbie@example.test');
    fd.set('hotelId', HOTEL_ID);

    const result = await inviteHotelMember({}, fd);
    expect(result.error).toMatch(/Could not send the invite/);
    const auditEntry = writeAuditLogMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(auditEntry.action).toBe('invite_failed');
  });
});

// ---- inviteBusinessMember -------------------------------------------------

describe('inviteBusinessMember', () => {
  it('parses input, INSERTs into business_users, audit-logs invite_issued', async () => {
    const { supabase, stub } = makeSupabase({
      user: { id: ADMIN_USER_ID, email: ADMIN_EMAIL },
    });
    createServerClientMock.mockResolvedValue(supabase);
    getMembershipSetMock.mockResolvedValue({
      userId: ADMIN_USER_ID,
      email: ADMIN_EMAIL,
      isStrictonsStaff: false,
      roles: [
        {
          kind: 'business_admin',
          businessId: BUSINESS_ID,
          businessName: 'Sunrise Joyflights',
        },
      ],
    });

    const { inviteBusinessMember } = await import('./actions');
    const fd = new FormData();
    fd.set('email', 'partner@example.test');
    fd.set('businessId', BUSINESS_ID);

    const result = await inviteBusinessMember({}, fd);

    expect(result).toEqual({ ok: true });
    expect(supabase.from).toHaveBeenCalledWith('business_users');
    expect(stub.insertedPayload).toEqual({
      business_id: BUSINESS_ID,
      invited_email: 'partner@example.test',
      invited_by: ADMIN_USER_ID,
    });
    const auditEntry = writeAuditLogMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(auditEntry.action).toBe('invite_issued');
    expect(auditEntry.actor_role).toBe('business_admin');
    expect(auditEntry.entity_type).toBe('business_users');
    expect(auditEntry.entity_business_id).toBe(BUSINESS_ID);
  });
});

// ---- revokeMember ---------------------------------------------------------

describe('revokeMember', () => {
  it('looks up the row, UPDATEs revoked_at + revoked_by, audit-logs invite_revoked', async () => {
    const { supabase, stub } = makeSupabase({
      user: { id: ADMIN_USER_ID, email: ADMIN_EMAIL },
      lookupResponse: {
        data: { id: NEW_MEMBERSHIP_ID, hotel_id: HOTEL_ID, user_id: 'someone-else' },
        error: null,
      },
    });
    createServerClientMock.mockResolvedValue(supabase);
    getMembershipSetMock.mockResolvedValue({
      userId: ADMIN_USER_ID,
      email: ADMIN_EMAIL,
      isStrictonsStaff: false,
      roles: [
        {
          kind: 'hotel_admin',
          hotelId: HOTEL_ID,
          hotelSlug: 'alpha',
          hotelName: 'Alpha Hotel',
        },
      ],
    });

    const { revokeMember } = await import('./actions');
    const fd = new FormData();
    fd.set('membershipId', NEW_MEMBERSHIP_ID);
    fd.set('scope', 'hotel');

    const result = await revokeMember({}, fd);

    expect(result).toEqual({ ok: true });
    const updated = stub.updatedPayload as Record<string, unknown>;
    expect(updated.revoked_by).toBe(ADMIN_USER_ID);
    expect(typeof updated.revoked_at).toBe('string');

    const auditEntry = writeAuditLogMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(auditEntry.action).toBe('invite_revoked');
    expect(auditEntry.actor_role).toBe('hotel_admin');
    expect(auditEntry.entity_type).toBe('hotel_users');
    expect(auditEntry.entity_hotel_id).toBe(HOTEL_ID);
  });

  it('refuses to revoke the calling admin themselves', async () => {
    const { supabase } = makeSupabase({
      user: { id: ADMIN_USER_ID, email: ADMIN_EMAIL },
      lookupResponse: {
        data: { id: NEW_MEMBERSHIP_ID, hotel_id: HOTEL_ID, user_id: ADMIN_USER_ID },
        error: null,
      },
    });
    createServerClientMock.mockResolvedValue(supabase);
    getMembershipSetMock.mockResolvedValue({
      userId: ADMIN_USER_ID,
      email: ADMIN_EMAIL,
      isStrictonsStaff: false,
      roles: [
        {
          kind: 'hotel_admin',
          hotelId: HOTEL_ID,
          hotelSlug: 'alpha',
          hotelName: 'Alpha Hotel',
        },
      ],
    });

    const { revokeMember } = await import('./actions');
    const fd = new FormData();
    fd.set('membershipId', NEW_MEMBERSHIP_ID);
    fd.set('scope', 'hotel');

    const result = await revokeMember({}, fd);
    expect(result.error).toMatch(/cannot revoke your own/i);
  });

  it('refuses when the caller does not admin the membership scope', async () => {
    const { supabase } = makeSupabase({
      user: { id: ADMIN_USER_ID, email: ADMIN_EMAIL },
      lookupResponse: {
        data: { id: NEW_MEMBERSHIP_ID, hotel_id: HOTEL_ID, user_id: 'someone-else' },
        error: null,
      },
    });
    createServerClientMock.mockResolvedValue(supabase);
    getMembershipSetMock.mockResolvedValue({
      userId: ADMIN_USER_ID,
      email: ADMIN_EMAIL,
      isStrictonsStaff: false,
      roles: [
        {
          kind: 'hotel_admin',
          hotelId: OTHER_HOTEL_ID,
          hotelSlug: 'other',
          hotelName: 'Other Hotel',
        },
      ],
    });

    const { revokeMember } = await import('./actions');
    const fd = new FormData();
    fd.set('membershipId', NEW_MEMBERSHIP_ID);
    fd.set('scope', 'hotel');

    const result = await revokeMember({}, fd);
    expect(result.error).toMatch(/do not admin/i);
  });

  it('rejects an unknown scope at the schema level', async () => {
    const { revokeMember } = await import('./actions');
    const fd = new FormData();
    fd.set('membershipId', NEW_MEMBERSHIP_ID);
    fd.set('scope', 'strictons');

    const result = await revokeMember({}, fd);
    expect(result.error).toMatch(/Invalid revoke payload/);
  });

  it('returns "Membership not found" when lookup is empty', async () => {
    const { supabase } = makeSupabase({
      user: { id: ADMIN_USER_ID, email: ADMIN_EMAIL },
      lookupResponse: { data: null, error: null },
    });
    createServerClientMock.mockResolvedValue(supabase);

    const { revokeMember } = await import('./actions');
    const fd = new FormData();
    fd.set('membershipId', NEW_MEMBERSHIP_ID);
    fd.set('scope', 'hotel');

    const result = await revokeMember({}, fd);
    expect(result.error).toMatch(/Membership not found/);
  });
});
