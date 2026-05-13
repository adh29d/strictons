import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ---------------------------------------------------------------

const createServiceRoleClientMock = vi.fn();
const sendHotelAdminInviteMock = vi.fn();
const sendHotelAdminResendMock = vi.fn();

vi.mock('@strictons/db/client', () => ({
  createServiceRoleClient: () => createServiceRoleClientMock(),
}));

vi.mock('@strictons/email/send', () => ({
  sendHotelAdminInvite: (...args: unknown[]) => sendHotelAdminInviteMock(...args),
  sendHotelAdminResend: (...args: unknown[]) => sendHotelAdminResendMock(...args),
}));

// MAGIC_LINK_EXPIRY_MINUTES is a real constant; import the real module.
// resolveAppUrl + buildConfirmUrl are pure functions over process.env;
// don't mock — we exercise the real construction path.

// ---- Helpers -------------------------------------------------------------

const HOTEL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HOTEL_NAME = 'Test Beachcomber Hotel';
const INVITEE_EMAIL = 'invitee@example.test';
const PARTNERS_URL = 'https://partners.strictons.test';
const TOKEN_HASH = 'opaque-hashed-token-from-supabase';

function makeServiceClient(opts: {
  generateResponse?: {
    data: { properties?: { hashed_token?: string } } | null;
    error: { message: string } | null;
  };
}) {
  const generateLinkStub = vi.fn().mockResolvedValue(
    opts.generateResponse ?? {
      data: { properties: { hashed_token: TOKEN_HASH } },
      error: null,
    },
  );
  return {
    generateLinkStub,
    client: {
      auth: {
        admin: {
          generateLink: generateLinkStub,
        },
      },
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  createServiceRoleClientMock.mockReset();
  sendHotelAdminInviteMock.mockReset();
  sendHotelAdminResendMock.mockReset();
  // Default: env var IS set. Tests that exercise the missing-env path
  // delete it explicitly.
  process.env.NEXT_PUBLIC_PARTNERS_URL = PARTNERS_URL;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_PARTNERS_URL;
});

// ---- Tests ---------------------------------------------------------------

describe('sendHotelAdminMagicLink — kind: invite', () => {
  it('generates a magic link via service-role and dispatches to sendHotelAdminInvite', async () => {
    const { client, generateLinkStub } = makeServiceClient({});
    createServiceRoleClientMock.mockReturnValue(client);
    sendHotelAdminInviteMock.mockResolvedValue({ transport: 'memory', to: INVITEE_EMAIL });

    const { sendHotelAdminMagicLink } = await import('./hotel-admin-magic-link');

    const result = await sendHotelAdminMagicLink({
      hotelId: HOTEL_ID,
      hotelName: HOTEL_NAME,
      email: INVITEE_EMAIL,
      kind: 'invite',
    });

    // generateLink called with magiclink + the partners redirectTo
    expect(generateLinkStub).toHaveBeenCalledTimes(1);
    const generateArgs = generateLinkStub.mock.calls[0]?.[0] as {
      type: string;
      email: string;
      options: { redirectTo: string };
    };
    expect(generateArgs.type).toBe('magiclink');
    expect(generateArgs.email).toBe(INVITEE_EMAIL);
    expect(generateArgs.options.redirectTo).toBe(`${PARTNERS_URL}/auth/confirm?next=%2F`);

    // sendHotelAdminInvite called with the constructed link
    expect(sendHotelAdminInviteMock).toHaveBeenCalledTimes(1);
    expect(sendHotelAdminResendMock).not.toHaveBeenCalled();
    const sendArgs = sendHotelAdminInviteMock.mock.calls[0]?.[0] as {
      to: string;
      link: string;
      hotelName: string;
    };
    expect(sendArgs.to).toBe(INVITEE_EMAIL);
    expect(sendArgs.hotelName).toBe(HOTEL_NAME);
    expect(sendArgs.link).toContain(`${PARTNERS_URL}/auth/confirm`);
    expect(sendArgs.link).toContain(`token_hash=${TOKEN_HASH}`);
    expect(sendArgs.link).toContain('type=email');
    expect(sendArgs.link).toContain('next=%2F');

    // Returned link matches the one passed to send
    expect(result.link).toBe(sendArgs.link);
    expect(result.transportResult).toEqual({ transport: 'memory', to: INVITEE_EMAIL });
  });
});

describe('sendHotelAdminMagicLink — kind: resend', () => {
  it('generates a magic link via service-role and dispatches to sendHotelAdminResend', async () => {
    const { client, generateLinkStub } = makeServiceClient({});
    createServiceRoleClientMock.mockReturnValue(client);
    sendHotelAdminResendMock.mockResolvedValue({ transport: 'memory', to: INVITEE_EMAIL });

    const { sendHotelAdminMagicLink } = await import('./hotel-admin-magic-link');

    const result = await sendHotelAdminMagicLink({
      hotelId: HOTEL_ID,
      hotelName: HOTEL_NAME,
      email: INVITEE_EMAIL,
      kind: 'resend',
    });

    expect(generateLinkStub).toHaveBeenCalledTimes(1);
    expect(sendHotelAdminResendMock).toHaveBeenCalledTimes(1);
    expect(sendHotelAdminInviteMock).not.toHaveBeenCalled();
    const sendArgs = sendHotelAdminResendMock.mock.calls[0]?.[0] as {
      to: string;
      link: string;
      hotelName: string;
    };
    expect(sendArgs.to).toBe(INVITEE_EMAIL);
    expect(sendArgs.hotelName).toBe(HOTEL_NAME);
    expect(sendArgs.link).toContain(`token_hash=${TOKEN_HASH}`);

    expect(result.transportResult).toEqual({ transport: 'memory', to: INVITEE_EMAIL });
  });
});

describe('sendHotelAdminMagicLink — missing env var', () => {
  it('throws with a useful message naming the env var when NEXT_PUBLIC_PARTNERS_URL is unset', async () => {
    delete process.env.NEXT_PUBLIC_PARTNERS_URL;

    const { sendHotelAdminMagicLink } = await import('./hotel-admin-magic-link');

    await expect(
      sendHotelAdminMagicLink({
        hotelId: HOTEL_ID,
        hotelName: HOTEL_NAME,
        email: INVITEE_EMAIL,
        kind: 'invite',
      }),
    ).rejects.toThrow(/NEXT_PUBLIC_PARTNERS_URL/);

    // Critically, neither the supabase admin call nor the transport was reached.
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(sendHotelAdminInviteMock).not.toHaveBeenCalled();
    expect(sendHotelAdminResendMock).not.toHaveBeenCalled();
  });
});

describe('sendHotelAdminMagicLink — generateLink failure', () => {
  it('bubbles the generateLink error unchanged and does not call the transport', async () => {
    const cause = new Error('upstream gotrue error: rate limited');
    const { client } = makeServiceClient({
      generateResponse: { data: null, error: { message: cause.message } },
    });
    // The action under test throws `generateError` directly — emulate
    // the SDK by attaching an Error-shaped object as `error`.
    client.auth.admin.generateLink = vi
      .fn()
      .mockResolvedValue({ data: null, error: cause });
    createServiceRoleClientMock.mockReturnValue(client);

    const { sendHotelAdminMagicLink } = await import('./hotel-admin-magic-link');

    await expect(
      sendHotelAdminMagicLink({
        hotelId: HOTEL_ID,
        hotelName: HOTEL_NAME,
        email: INVITEE_EMAIL,
        kind: 'invite',
      }),
    ).rejects.toBe(cause);

    expect(sendHotelAdminInviteMock).not.toHaveBeenCalled();
    expect(sendHotelAdminResendMock).not.toHaveBeenCalled();
  });

  it('throws a descriptive error when generateLink returns no hashed_token', async () => {
    const { client } = makeServiceClient({
      generateResponse: { data: { properties: {} }, error: null },
    });
    createServiceRoleClientMock.mockReturnValue(client);

    const { sendHotelAdminMagicLink } = await import('./hotel-admin-magic-link');

    await expect(
      sendHotelAdminMagicLink({
        hotelId: HOTEL_ID,
        hotelName: HOTEL_NAME,
        email: INVITEE_EMAIL,
        kind: 'invite',
      }),
    ).rejects.toThrow(/hashed_token/);

    expect(sendHotelAdminInviteMock).not.toHaveBeenCalled();
  });
});

describe('sendHotelAdminMagicLink — transport failure', () => {
  it('bubbles the transport error unchanged from the invite path', async () => {
    const { client } = makeServiceClient({});
    createServiceRoleClientMock.mockReturnValue(client);
    const cause = new Error('EmailSendError(transport=sendgrid, …): network');
    sendHotelAdminInviteMock.mockRejectedValue(cause);

    const { sendHotelAdminMagicLink } = await import('./hotel-admin-magic-link');

    await expect(
      sendHotelAdminMagicLink({
        hotelId: HOTEL_ID,
        hotelName: HOTEL_NAME,
        email: INVITEE_EMAIL,
        kind: 'invite',
      }),
    ).rejects.toBe(cause);
  });

  it('bubbles the transport error unchanged from the resend path', async () => {
    const { client } = makeServiceClient({});
    createServiceRoleClientMock.mockReturnValue(client);
    const cause = new Error('EmailSendError(transport=sendgrid, …): timeout');
    sendHotelAdminResendMock.mockRejectedValue(cause);

    const { sendHotelAdminMagicLink } = await import('./hotel-admin-magic-link');

    await expect(
      sendHotelAdminMagicLink({
        hotelId: HOTEL_ID,
        hotelName: HOTEL_NAME,
        email: INVITEE_EMAIL,
        kind: 'resend',
      }),
    ).rejects.toBe(cause);
  });
});
