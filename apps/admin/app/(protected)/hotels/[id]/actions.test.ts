import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ---------------------------------------------------------------

const createServiceRoleClientMock = vi.fn();
const writeAuditLogMock = vi.fn();
const revalidatePathMock = vi.fn();
const requireStaffMock = vi.fn();
const sendHotelAdminMagicLinkMock = vi.fn();

// EmailSendError is a real class — import the real module so
// `instanceof EmailSendError` works inside the action under test.
// Everything else is mocked.
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
vi.mock('./_lib/hotel-admin-magic-link', () => ({
  sendHotelAdminMagicLink: (...args: unknown[]) => sendHotelAdminMagicLinkMock(...args),
}));

// ---- Helpers -------------------------------------------------------------

const STAFF_USER_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_EMAIL = 'staff@strictons.test';
const HOTEL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_HOTEL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HOTEL_NAME = 'Test Beachcomber Hotel';
const HOTEL_SLUG = 'test-beachcomber';
const NEW_HOTEL_USER_ID = '22222222-2222-4222-9222-222222222222';
const EXISTING_HOTEL_USER_ID = '33333333-3333-4333-8333-333333333333';
const INVITEE_EMAIL = 'invitee@example.test';

type ChainResponse = { data: unknown; error: unknown };

/**
 * Build a service-role client stub that returns the configured response
 * for each tabled chain shape:
 *
 *   - hotels.select(...).eq('id', ...).maybeSingle() → hotelLookup
 *   - hotel_users.insert(...).select('id').single() → hotelUserInsert
 *   - hotel_users.select(...).eq('id', ...).maybeSingle() → hotelUserLookup
 */
function makeServiceClient(opts: {
  hotelLookup?: ChainResponse;
  hotelUserInsert?: ChainResponse;
  hotelUserLookup?: ChainResponse;
}) {
  const insertedPayloads: unknown[] = [];
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'hotels') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve(
                  opts.hotelLookup ?? {
                    data: { id: HOTEL_ID, name: HOTEL_NAME, slug: HOTEL_SLUG },
                    error: null,
                  },
                ),
              ),
            })),
          })),
        };
      }
      if (table === 'hotel_users') {
        return {
          insert: vi.fn((payload: unknown) => {
            insertedPayloads.push(payload);
            return {
              select: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve(
                    opts.hotelUserInsert ?? {
                      data: { id: NEW_HOTEL_USER_ID },
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
                Promise.resolve(
                  opts.hotelUserLookup ?? {
                    data: null,
                    error: null,
                  },
                ),
              ),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { client, insertedPayloads };
}

function makeFormDataInvite(opts: { hotelId?: string; email?: string } = {}): FormData {
  const fd = new FormData();
  fd.set('hotelId', opts.hotelId ?? HOTEL_ID);
  fd.set('email', opts.email ?? INVITEE_EMAIL);
  return fd;
}

function makeFormDataResend(opts: { hotelId?: string; hotelUserId?: string } = {}): FormData {
  const fd = new FormData();
  fd.set('hotelId', opts.hotelId ?? HOTEL_ID);
  fd.set('hotelUserId', opts.hotelUserId ?? EXISTING_HOTEL_USER_ID);
  return fd;
}

beforeEach(() => {
  vi.resetModules();
  createServiceRoleClientMock.mockReset();
  writeAuditLogMock.mockReset();
  writeAuditLogMock.mockResolvedValue(undefined);
  revalidatePathMock.mockReset();
  requireStaffMock.mockReset();
  sendHotelAdminMagicLinkMock.mockReset();
  // Default: staff. Tests that exercise the not-staff branch override.
  requireStaffMock.mockResolvedValue({
    kind: 'ok',
    userId: STAFF_USER_ID,
    email: STAFF_EMAIL,
  });
  sendHotelAdminMagicLinkMock.mockResolvedValue({
    link: 'https://partners.strictons.test/auth/confirm?token_hash=x&type=email&next=%2F',
    transportResult: { transport: 'memory', to: INVITEE_EMAIL },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// inviteHotelAdmin
// ===========================================================================

describe('inviteHotelAdmin', () => {
  it('happy path — INSERTs with is_admin: true, sends magic link, audits, revalidates', async () => {
    const { client, insertedPayloads } = makeServiceClient({});
    createServiceRoleClientMock.mockReturnValue(client);

    const { inviteHotelAdmin } = await import('./actions');
    const state = await inviteHotelAdmin({}, makeFormDataInvite());

    expect(state).toEqual({ ok: true, message: 'Invitation sent.' });

    // INSERT payload has is_admin: true EXPLICITLY (the locked
    // decision: idempotent with the auto-promote trigger).
    expect(insertedPayloads).toHaveLength(1);
    expect(insertedPayloads[0]).toEqual({
      hotel_id: HOTEL_ID,
      invited_email: INVITEE_EMAIL,
      invited_by: STAFF_USER_ID,
      is_admin: true,
    });

    // Magic-link dispatched with the right kind
    expect(sendHotelAdminMagicLinkMock).toHaveBeenCalledTimes(1);
    const sendArgs = sendHotelAdminMagicLinkMock.mock.calls[0]?.[0] as {
      hotelId: string;
      hotelName: string;
      email: string;
      kind: string;
    };
    expect(sendArgs).toEqual({
      hotelId: HOTEL_ID,
      hotelName: HOTEL_NAME,
      email: INVITEE_EMAIL,
      kind: 'invite',
    });

    // revalidatePath called with the literal route, not the resolved path
    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]');

    // Audit-log success row written with the right action + actor_role
    const auditCalls = writeAuditLogMock.mock.calls.map((c) => c[0] as { action: string });
    expect(auditCalls.some((c) => c.action === 'hotel_admin_invite_issued')).toBe(true);
    const successEntry = writeAuditLogMock.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'hotel_admin_invite_issued',
    )?.[0] as { actor_role: string; entity_id: string; entity_hotel_id: string };
    expect(successEntry.actor_role).toBe('strictons_staff');
    expect(successEntry.entity_id).toBe(NEW_HOTEL_USER_ID);
    expect(successEntry.entity_hotel_id).toBe(HOTEL_ID);
  });

  it('rejects when caller is not staff', async () => {
    requireStaffMock.mockResolvedValue({ kind: 'error', error: 'Not signed in.' });

    const { inviteHotelAdmin } = await import('./actions');
    const state = await inviteHotelAdmin({}, makeFormDataInvite());

    expect(state).toEqual({ error: 'Not signed in.' });
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(sendHotelAdminMagicLinkMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('returns Hotel not found when the hotel SELECT returns no row', async () => {
    const { client } = makeServiceClient({
      hotelLookup: { data: null, error: null },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { inviteHotelAdmin } = await import('./actions');
    const state = await inviteHotelAdmin({}, makeFormDataInvite());

    expect(state.error).toBe('Hotel not found.');
    expect(sendHotelAdminMagicLinkMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();

    // Audit row with reason 'hotel_not_found'
    const failureEntry = writeAuditLogMock.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'hotel_admin_invite_failed',
    )?.[0] as { after: { reason: string } };
    expect(failureEntry.after.reason).toBe('hotel_not_found');
  });

  it('surfaces 23505 unique-violation as fieldErrors.email with reason already_invited', async () => {
    const { client } = makeServiceClient({
      hotelUserInsert: {
        data: null,
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "hotel_users_hotel_id_invited_email_key"',
        },
      },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { inviteHotelAdmin } = await import('./actions');
    const state = await inviteHotelAdmin({}, makeFormDataInvite());

    expect(state.ok).toBeUndefined();
    expect(state.fieldErrors?.email).toContain('already on this hotel');
    expect(state.fieldErrors?.email).toContain('Resend portal access link');
    expect(sendHotelAdminMagicLinkMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();

    const failureEntry = writeAuditLogMock.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'hotel_admin_invite_failed',
    )?.[0] as { after: { reason: string } };
    expect(failureEntry.after.reason).toBe('already_invited');
  });

  it('bubbles generateLink failure into audit reason generate_link_failed', async () => {
    const { client } = makeServiceClient({});
    createServiceRoleClientMock.mockReturnValue(client);
    sendHotelAdminMagicLinkMock.mockRejectedValue(new Error('upstream gotrue: rate limited'));

    const { inviteHotelAdmin } = await import('./actions');
    const state = await inviteHotelAdmin({}, makeFormDataInvite());

    expect(state.error).toBe('Could not send invitation. Please try again.');
    expect(revalidatePathMock).not.toHaveBeenCalled();

    const failureEntry = writeAuditLogMock.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'hotel_admin_invite_failed',
    )?.[0] as { after: { reason: string }; entity_id: string };
    expect(failureEntry.after.reason).toBe('generate_link_failed');
    // The hotel_users row was inserted before the send failed; entity_id is the new row's id.
    expect(failureEntry.entity_id).toBe(NEW_HOTEL_USER_ID);
  });

  it('classifies EmailSendError as audit reason send_failed', async () => {
    const { client } = makeServiceClient({});
    createServiceRoleClientMock.mockReturnValue(client);

    // Construct a real EmailSendError so `instanceof` inside the action holds.
    const { EmailSendError } = await import('@strictons/email/send');
    sendHotelAdminMagicLinkMock.mockRejectedValue(
      new EmailSendError('sendgrid', INVITEE_EMAIL, new Error('network')),
    );

    const { inviteHotelAdmin } = await import('./actions');
    const state = await inviteHotelAdmin({}, makeFormDataInvite());

    expect(state.error).toBe('Could not send invitation. Please try again.');
    const failureEntry = writeAuditLogMock.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'hotel_admin_invite_failed',
    )?.[0] as { after: { reason: string } };
    expect(failureEntry.after.reason).toBe('send_failed');
  });
});

// ===========================================================================
// resendPortalAccessLink
// ===========================================================================

describe('resendPortalAccessLink', () => {
  it('happy path — sends magic link, audits portal_access_link_resent, revalidates', async () => {
    const { client } = makeServiceClient({
      hotelUserLookup: {
        data: {
          id: EXISTING_HOTEL_USER_ID,
          hotel_id: HOTEL_ID,
          invited_email: INVITEE_EMAIL,
          revoked_at: null,
        },
        error: null,
      },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { resendPortalAccessLink } = await import('./actions');
    const state = await resendPortalAccessLink({}, makeFormDataResend());

    expect(state).toEqual({ ok: true, message: 'Portal access link resent.' });

    expect(sendHotelAdminMagicLinkMock).toHaveBeenCalledTimes(1);
    const sendArgs = sendHotelAdminMagicLinkMock.mock.calls[0]?.[0] as {
      hotelId: string;
      hotelName: string;
      email: string;
      kind: string;
    };
    expect(sendArgs.kind).toBe('resend');
    expect(sendArgs.email).toBe(INVITEE_EMAIL);
    expect(sendArgs.hotelName).toBe(HOTEL_NAME);

    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels/[id]');

    const successEntry = writeAuditLogMock.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'portal_access_link_resent',
    )?.[0] as { actor_role: string; entity_id: string; entity_hotel_id: string };
    expect(successEntry.actor_role).toBe('strictons_staff');
    expect(successEntry.entity_id).toBe(EXISTING_HOTEL_USER_ID);
    expect(successEntry.entity_hotel_id).toBe(HOTEL_ID);
  });

  it('rejects when caller is not staff', async () => {
    requireStaffMock.mockResolvedValue({ kind: 'error', error: 'Not signed in.' });

    const { resendPortalAccessLink } = await import('./actions');
    const state = await resendPortalAccessLink({}, makeFormDataResend());

    expect(state).toEqual({ error: 'Not signed in.' });
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(sendHotelAdminMagicLinkMock).not.toHaveBeenCalled();
  });

  it('returns Hotel admin not found when the hotel_users row is missing', async () => {
    const { client } = makeServiceClient({
      hotelUserLookup: { data: null, error: null },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { resendPortalAccessLink } = await import('./actions');
    const state = await resendPortalAccessLink({}, makeFormDataResend());

    expect(state.error).toBe('Hotel admin not found.');
    expect(sendHotelAdminMagicLinkMock).not.toHaveBeenCalled();

    const failureEntry = writeAuditLogMock.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'portal_access_link_resend_failed',
    )?.[0] as { after: { reason: string } };
    expect(failureEntry.after.reason).toBe('not_found');
  });

  it('rejects revoked rows without attempting send (audit reason: revoked)', async () => {
    const REVOKED_AT = '2026-05-01T10:00:00.000Z';
    const { client } = makeServiceClient({
      hotelUserLookup: {
        data: {
          id: EXISTING_HOTEL_USER_ID,
          hotel_id: HOTEL_ID,
          invited_email: INVITEE_EMAIL,
          revoked_at: REVOKED_AT,
        },
        error: null,
      },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { resendPortalAccessLink } = await import('./actions');
    const state = await resendPortalAccessLink({}, makeFormDataResend());

    expect(state.error).toBe('This admin has been revoked. Cannot resend access link.');
    expect(sendHotelAdminMagicLinkMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();

    const failureEntry = writeAuditLogMock.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'portal_access_link_resend_failed',
    )?.[0] as { after: { reason: string; revoked_at?: string } };
    expect(failureEntry.after.reason).toBe('revoked');
    expect(failureEntry.after.revoked_at).toBe(REVOKED_AT);
  });

  it('rejects cross-hotel id smuggling (hotel_users.hotel_id !== submitted hotelId)', async () => {
    // The form on hotel HOTEL_ID's page submits a hotel_user id that
    // belongs to OTHER_HOTEL_ID. The server-side cross-check must
    // reject without attempting send.
    const { client } = makeServiceClient({
      hotelUserLookup: {
        data: {
          id: EXISTING_HOTEL_USER_ID,
          hotel_id: OTHER_HOTEL_ID,
          invited_email: INVITEE_EMAIL,
          revoked_at: null,
        },
        error: null,
      },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { resendPortalAccessLink } = await import('./actions');
    const state = await resendPortalAccessLink({}, makeFormDataResend());

    // Same surface-facing error as "not found" — don't leak the
    // existence of a hotel_user belonging to another hotel.
    expect(state.error).toBe('Hotel admin not found.');
    expect(sendHotelAdminMagicLinkMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();

    const failureEntry = writeAuditLogMock.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'portal_access_link_resend_failed',
    )?.[0] as {
      after: { reason: string; submitted_hotel_id?: string; actual_hotel_id?: string };
    };
    expect(failureEntry.after.reason).toBe('cross_hotel_smuggling');
    expect(failureEntry.after.submitted_hotel_id).toBe(HOTEL_ID);
    expect(failureEntry.after.actual_hotel_id).toBe(OTHER_HOTEL_ID);
  });

  it('classifies transport failure as audit reason send_failed', async () => {
    const { client } = makeServiceClient({
      hotelUserLookup: {
        data: {
          id: EXISTING_HOTEL_USER_ID,
          hotel_id: HOTEL_ID,
          invited_email: INVITEE_EMAIL,
          revoked_at: null,
        },
        error: null,
      },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { EmailSendError } = await import('@strictons/email/send');
    sendHotelAdminMagicLinkMock.mockRejectedValue(
      new EmailSendError('sendgrid', INVITEE_EMAIL, new Error('timeout')),
    );

    const { resendPortalAccessLink } = await import('./actions');
    const state = await resendPortalAccessLink({}, makeFormDataResend());

    expect(state.error).toBe('Could not resend portal access link. Please try again.');
    expect(revalidatePathMock).not.toHaveBeenCalled();

    const failureEntry = writeAuditLogMock.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'portal_access_link_resend_failed',
    )?.[0] as { after: { reason: string } };
    expect(failureEntry.after.reason).toBe('send_failed');
  });
});
