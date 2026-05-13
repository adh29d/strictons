import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ---------------------------------------------------------------

const createServerClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const getMembershipSetMock = vi.fn();
const writeAuditLogMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectMock = vi.fn((_url: string) => {
  // Mirror Next.js's `redirect()` semantics: throws a tagged error
  // that the caller must NOT catch. Our actions call this as a
  // terminal success path.
  const e = new Error('NEXT_REDIRECT');
  (e as Error & { digest?: string }).digest = 'NEXT_REDIRECT';
  throw e;
});

vi.mock('@strictons/db/server', () => ({
  createServerClient: () => createServerClientMock(),
}));
vi.mock('@strictons/db/client', () => ({
  createServiceRoleClient: () => createServiceRoleClientMock(),
}));
vi.mock('@strictons/db/roles', () => ({
  getMembershipSet: (...args: unknown[]) => getMembershipSetMock(...args),
}));
vi.mock('@strictons/db/audit', () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLogMock(...args),
}));
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

// ---- Helpers -------------------------------------------------------------

const STAFF_USER_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_EMAIL = 'staff@strictons.test';
const NEW_HOTEL_ID = '22222222-2222-4222-9222-222222222222';
const EXISTING_HOTEL_ID = '33333333-3333-4333-8333-333333333333';

type ChainResponse = { data: unknown; error: unknown };

function makeAuthClient(user: { id: string; email: string } | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  };
}

function makeServiceClient(opts: {
  insertResponse?: ChainResponse;
  lookupResponse?: ChainResponse;
  updateResponse?: ChainResponse;
}) {
  const stub: { insertedPayload?: unknown; updatedPayload?: unknown } = {};
  return {
    stub,
    client: {
      from: vi.fn(() => ({
        insert: vi.fn((payload: unknown) => {
          stub.insertedPayload = payload;
          return {
            select: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve(
                  opts.insertResponse ?? {
                    data: { id: NEW_HOTEL_ID },
                    error: null,
                  },
                ),
              ),
            })),
          };
        }),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve(opts.lookupResponse ?? { data: null, error: null }),
            ),
            maybeSingle: vi.fn(() =>
              Promise.resolve(opts.lookupResponse ?? { data: null, error: null }),
            ),
          })),
          order: vi.fn(() => Promise.resolve(opts.lookupResponse ?? { data: null, error: null })),
        })),
        update: vi.fn((payload: unknown) => {
          stub.updatedPayload = payload;
          return {
            eq: vi.fn(() => Promise.resolve(opts.updateResponse ?? { data: null, error: null })),
          };
        }),
      })),
    },
  };
}

const validCreateForm = (): FormData => {
  const fd = new FormData();
  fd.set('name', 'Beachcomber Hotel');
  fd.set('slug', 'beachcomber');
  fd.set('contact_email', 'reception@beachcomber.test');
  fd.set('approval_state', 'pending_design_meeting');
  fd.set('custom_domain', '');
  return fd;
};

const validUpdateForm = (): FormData => {
  const fd = new FormData();
  fd.set('id', EXISTING_HOTEL_ID);
  fd.set('name', 'Beachcomber Hotel — updated');
  fd.set('contact_email', 'reception@beachcomber.test');
  fd.set('approval_state', 'design_meeting_held');
  fd.set('custom_domain', '');
  return fd;
};

beforeEach(() => {
  createServerClientMock.mockReset();
  createServiceRoleClientMock.mockReset();
  getMembershipSetMock.mockReset();
  writeAuditLogMock.mockReset();
  writeAuditLogMock.mockResolvedValue(undefined);
  revalidatePathMock.mockReset();
  redirectMock.mockClear();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ----------------------------------------------------------------------------
// createHotel
// ----------------------------------------------------------------------------

describe('createHotel', () => {
  it('rejects when caller is not staff', async () => {
    createServerClientMock.mockResolvedValue(
      makeAuthClient({ id: STAFF_USER_ID, email: STAFF_EMAIL }),
    );
    getMembershipSetMock.mockResolvedValue({
      userId: STAFF_USER_ID,
      email: STAFF_EMAIL,
      isStrictonsStaff: false,
      roles: [],
    });

    const { createHotel } = await import('./actions');
    const result = await createHotel({}, validCreateForm());

    expect(result.error).toMatch(/staff access/i);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it('rejects when not signed in', async () => {
    createServerClientMock.mockResolvedValue(makeAuthClient(null));

    const { createHotel } = await import('./actions');
    const result = await createHotel({}, validCreateForm());

    expect(result.error).toMatch(/not signed in/i);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it('returns field errors when payload is invalid', async () => {
    createServerClientMock.mockResolvedValue(
      makeAuthClient({ id: STAFF_USER_ID, email: STAFF_EMAIL }),
    );
    getMembershipSetMock.mockResolvedValue({
      userId: STAFF_USER_ID,
      email: STAFF_EMAIL,
      isStrictonsStaff: true,
      roles: [],
    });

    const { createHotel } = await import('./actions');
    const fd = validCreateForm();
    fd.set('slug', 'NOT_A_VALID_SLUG');
    fd.set('contact_email', 'not-an-email');

    const result = await createHotel({}, fd);

    expect(result.fieldErrors).toBeDefined();
    expect(result.fieldErrors!.slug).toBeDefined();
    expect(result.fieldErrors!.contact_email).toBeDefined();
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it('INSERTs via service-role, audit-logs, revalidates, redirects on success', async () => {
    createServerClientMock.mockResolvedValue(
      makeAuthClient({ id: STAFF_USER_ID, email: STAFF_EMAIL }),
    );
    getMembershipSetMock.mockResolvedValue({
      userId: STAFF_USER_ID,
      email: STAFF_EMAIL,
      isStrictonsStaff: true,
      roles: [],
    });
    const { client: service, stub } = makeServiceClient({
      insertResponse: { data: { id: NEW_HOTEL_ID }, error: null },
    });
    createServiceRoleClientMock.mockReturnValue(service);

    const { createHotel } = await import('./actions');

    // redirect() throws — wrap in expect().rejects to verify the
    // terminal success path runs to the redirect call.
    await expect(createHotel({}, validCreateForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(service.from).toHaveBeenCalledWith('hotels');
    expect(stub.insertedPayload).toMatchObject({
      name: 'Beachcomber Hotel',
      slug: 'beachcomber',
      contact_email: 'reception@beachcomber.test',
      approval_state: 'pending_design_meeting',
      custom_domain: null,
    });
    expect(writeAuditLogMock).toHaveBeenCalledTimes(1);
    const auditEntry = writeAuditLogMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(auditEntry.action).toBe('hotel_created');
    expect(auditEntry.actor_role).toBe('strictons_staff');
    expect(auditEntry.entity_id).toBe(NEW_HOTEL_ID);
    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels');
    expect(redirectMock).toHaveBeenCalledWith(`/hotels/${NEW_HOTEL_ID}`);
  });

  it('surfaces 23505 slug-unique violation as a field error', async () => {
    createServerClientMock.mockResolvedValue(
      makeAuthClient({ id: STAFF_USER_ID, email: STAFF_EMAIL }),
    );
    getMembershipSetMock.mockResolvedValue({
      userId: STAFF_USER_ID,
      email: STAFF_EMAIL,
      isStrictonsStaff: true,
      roles: [],
    });
    const { client: service } = makeServiceClient({
      insertResponse: {
        data: null,
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "hotels_slug_key"',
          details: 'Key (slug)=(beachcomber) already exists.',
        },
      },
    });
    createServiceRoleClientMock.mockReturnValue(service);

    const { createHotel } = await import('./actions');
    const result = await createHotel({}, validCreateForm());

    expect(result.fieldErrors?.slug).toMatch(/already taken/i);
    expect(redirectMock).not.toHaveBeenCalled();
    // Failure path still audits (invariant).
    expect(writeAuditLogMock).toHaveBeenCalledTimes(1);
    const auditEntry = writeAuditLogMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(auditEntry.action).toBe('hotel_create_failed');
  });

  it('normalises empty custom_domain to null', async () => {
    createServerClientMock.mockResolvedValue(
      makeAuthClient({ id: STAFF_USER_ID, email: STAFF_EMAIL }),
    );
    getMembershipSetMock.mockResolvedValue({
      userId: STAFF_USER_ID,
      email: STAFF_EMAIL,
      isStrictonsStaff: true,
      roles: [],
    });
    const { client: service, stub } = makeServiceClient({
      insertResponse: { data: { id: NEW_HOTEL_ID }, error: null },
    });
    createServiceRoleClientMock.mockReturnValue(service);

    const { createHotel } = await import('./actions');
    const fd = validCreateForm();
    fd.set('custom_domain', '   '); // whitespace-only counts as empty
    await expect(createHotel({}, fd)).rejects.toThrow('NEXT_REDIRECT');

    expect((stub.insertedPayload as { custom_domain: string | null }).custom_domain).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// updateHotel
// ----------------------------------------------------------------------------

describe('updateHotel', () => {
  it('rejects when caller is not staff', async () => {
    createServerClientMock.mockResolvedValue(
      makeAuthClient({ id: STAFF_USER_ID, email: STAFF_EMAIL }),
    );
    getMembershipSetMock.mockResolvedValue({
      userId: STAFF_USER_ID,
      email: STAFF_EMAIL,
      isStrictonsStaff: false,
      roles: [],
    });

    const { updateHotel } = await import('./actions');
    const result = await updateHotel({}, validUpdateForm());

    expect(result.error).toMatch(/staff access/i);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it('returns "Hotel not found" when the row lookup is empty', async () => {
    createServerClientMock.mockResolvedValue(
      makeAuthClient({ id: STAFF_USER_ID, email: STAFF_EMAIL }),
    );
    getMembershipSetMock.mockResolvedValue({
      userId: STAFF_USER_ID,
      email: STAFF_EMAIL,
      isStrictonsStaff: true,
      roles: [],
    });
    const { client: service } = makeServiceClient({
      lookupResponse: { data: null, error: null },
    });
    createServiceRoleClientMock.mockReturnValue(service);

    const { updateHotel } = await import('./actions');
    const result = await updateHotel({}, validUpdateForm());

    expect(result.error).toMatch(/not found/i);
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it('UPDATEs, audit-logs with before/after, revalidates, returns ok on success', async () => {
    createServerClientMock.mockResolvedValue(
      makeAuthClient({ id: STAFF_USER_ID, email: STAFF_EMAIL }),
    );
    getMembershipSetMock.mockResolvedValue({
      userId: STAFF_USER_ID,
      email: STAFF_EMAIL,
      isStrictonsStaff: true,
      roles: [],
    });
    const beforeRow = {
      name: 'Beachcomber Hotel',
      slug: 'beachcomber',
      contact_email: 'reception@beachcomber.test',
      approval_state: 'pending_design_meeting',
      custom_domain: null,
    };
    const { client: service, stub } = makeServiceClient({
      lookupResponse: { data: beforeRow, error: null },
      updateResponse: { data: null, error: null },
    });
    createServiceRoleClientMock.mockReturnValue(service);

    const { updateHotel } = await import('./actions');
    const result = await updateHotel({}, validUpdateForm());

    expect(result).toEqual({ ok: true });
    expect((stub.updatedPayload as { name?: string }).name).toBe('Beachcomber Hotel — updated');
    expect(writeAuditLogMock).toHaveBeenCalledTimes(1);
    const auditEntry = writeAuditLogMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(auditEntry.action).toBe('hotel_updated');
    expect(auditEntry.entity_id).toBe(EXISTING_HOTEL_ID);
    expect(auditEntry.before).toEqual(beforeRow);
    expect(revalidatePathMock).toHaveBeenCalledWith('/hotels');
    expect(revalidatePathMock).toHaveBeenCalledWith(`/hotels/${EXISTING_HOTEL_ID}`);
  });

  it('does NOT include slug in the update payload (immutable per the DB trigger)', async () => {
    createServerClientMock.mockResolvedValue(
      makeAuthClient({ id: STAFF_USER_ID, email: STAFF_EMAIL }),
    );
    getMembershipSetMock.mockResolvedValue({
      userId: STAFF_USER_ID,
      email: STAFF_EMAIL,
      isStrictonsStaff: true,
      roles: [],
    });
    const { client: service, stub } = makeServiceClient({
      lookupResponse: {
        data: {
          name: 'X',
          slug: 'x',
          contact_email: 'x@example.test',
          approval_state: 'pending_design_meeting',
          custom_domain: null,
        },
        error: null,
      },
      updateResponse: { data: null, error: null },
    });
    createServiceRoleClientMock.mockReturnValue(service);

    const { updateHotel } = await import('./actions');
    const fd = validUpdateForm();
    // Try to inject a slug; readUpdateForm doesn't read it and the
    // schema omits it. The patch should not carry slug regardless.
    fd.set('slug', 'sneaky-new-slug');
    await updateHotel({}, fd);

    expect(stub.updatedPayload).toBeDefined();
    expect((stub.updatedPayload as Record<string, unknown>).slug).toBeUndefined();
  });
});
