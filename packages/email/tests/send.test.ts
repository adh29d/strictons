import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sgSendMock = vi.fn();
const sgSetApiKeyMock = vi.fn();

vi.mock('@sendgrid/mail', () => ({
  default: {
    send: (...args: unknown[]) => sgSendMock(...args),
    setApiKey: (...args: unknown[]) => sgSetApiKeyMock(...args),
  },
}));

const ORIGINAL_ENV = { ...process.env };

describe('sendMagicLink', () => {
  beforeEach(() => {
    sgSendMock.mockReset();
    sgSetApiKeyMock.mockReset();
    sgSendMock.mockResolvedValue([{ statusCode: 202 }]);
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EMAIL_TRANSPORT;
    delete process.env.E2E_MODE;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.SENDGRID_FROM;
    delete process.env.SENDGRID_REPLY_TO;
  });

  afterEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  // ---- Memory transport ----------------------------------------------------

  it('memory transport: stores the rendered message correctly', async () => {
    process.env.EMAIL_TRANSPORT = 'memory';
    process.env.E2E_MODE = '1';

    const { sendMagicLink } = await import('../src/send');
    const { findMemoryInboxEntry, clearMemoryInbox } = await import('../src/transports/memory');
    clearMemoryInbox();

    const result = await sendMagicLink({
      to: 'alice@example.test',
      link: 'https://partners.strictons.com/auth/confirm?token_hash=abc&type=email',
    });

    expect(result).toEqual({ transport: 'memory', to: 'alice@example.test' });

    const entry = findMemoryInboxEntry('alice@example.test');
    expect(entry).toBeDefined();
    expect(entry!.from).toBe('welcome@strictons.com');
    expect(entry!.replyTo).toBe('welcome@strictons.com');
    expect(entry!.subject).toBe('Sign in to Strictons partners');
    expect(entry!.text).toContain('15 minutes');
    expect(entry!.text).toContain(
      'https://partners.strictons.com/auth/confirm?token_hash=abc&type=email',
    );
    expect(entry!.html).toContain('href="https://partners.strictons.com/auth/confirm');
  });

  it('memory transport: refuses to load without E2E_MODE=1', async () => {
    process.env.EMAIL_TRANSPORT = 'memory';
    delete process.env.E2E_MODE;

    const { sendMagicLink } = await import('../src/send');
    await expect(sendMagicLink({ to: 'alice@example.test', link: 'https://x' })).rejects.toThrow(
      /E2E_MODE=1/,
    );
  });

  // ---- SendGrid transport --------------------------------------------------

  it('sendgrid transport: calls sgMail.send with the right shape', async () => {
    process.env.EMAIL_TRANSPORT = 'sendgrid';
    process.env.SENDGRID_API_KEY = 'SG.test_key';

    const { sendMagicLink } = await import('../src/send');
    const result = await sendMagicLink({
      to: 'bob@example.test',
      link: 'https://partners.strictons.com/auth/confirm?token_hash=xyz',
      expiresInMinutes: 15,
    });

    expect(result).toEqual({ transport: 'sendgrid', to: 'bob@example.test' });
    expect(sgSetApiKeyMock).toHaveBeenCalledWith('SG.test_key');
    expect(sgSendMock).toHaveBeenCalledTimes(1);

    const payload = sgSendMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.to).toBe('bob@example.test');
    expect(payload.from).toBe('welcome@strictons.com');
    expect(payload.replyTo).toBe('welcome@strictons.com');
    expect(payload.subject).toBe('Sign in to Strictons partners');
    expect(payload.html).toContain('15 minutes');
    expect(payload.text).toContain('15 minutes');
  });

  it('sendgrid transport: bubbles errors as EmailSendError', async () => {
    process.env.EMAIL_TRANSPORT = 'sendgrid';
    process.env.SENDGRID_API_KEY = 'SG.test_key';
    sgSendMock.mockRejectedValue(new Error('SendGrid 503'));

    const { sendMagicLink } = await import('../src/send');
    const { EmailSendError } = await import('../src/transports/types');

    let caught: unknown = null;
    try {
      await sendMagicLink({ to: 'bob@example.test', link: 'https://x' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EmailSendError);
    const err = caught as InstanceType<typeof EmailSendError>;
    expect(err.transport).toBe('sendgrid');
    expect(err.to).toBe('bob@example.test');
    expect(err.cause).toBeInstanceOf(Error);
    expect((err.cause as Error).message).toBe('SendGrid 503');
  });

  it('sendgrid transport: throws EmailSendError when SENDGRID_API_KEY is missing', async () => {
    process.env.EMAIL_TRANSPORT = 'sendgrid';
    delete process.env.SENDGRID_API_KEY;

    const { sendMagicLink } = await import('../src/send');
    const { EmailSendError } = await import('../src/transports/types');

    let caught: unknown = null;
    try {
      await sendMagicLink({ to: 'bob@example.test', link: 'https://x' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EmailSendError);
    expect((caught as Error).message).toMatch(/SENDGRID_API_KEY/);
  });

  // ---- Console transport ---------------------------------------------------

  it('console transport: selected when EMAIL_TRANSPORT is unset', async () => {
    delete process.env.EMAIL_TRANSPORT;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const { sendMagicLink } = await import('../src/send');
    const result = await sendMagicLink({
      to: 'carol@example.test',
      link: 'https://x',
    });

    expect(result).toEqual({ transport: 'console', to: 'carol@example.test' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]![0]).toContain('carol@example.test');
    expect(logSpy.mock.calls[0]![0]).toContain('15 minutes');

    logSpy.mockRestore();
  });

  // ---- Transport selection -------------------------------------------------

  it('rejects unknown EMAIL_TRANSPORT values', async () => {
    process.env.EMAIL_TRANSPORT = 'smtp';
    const { sendMagicLink } = await import('../src/send');
    await expect(sendMagicLink({ to: 'a@b', link: 'https://x' })).rejects.toThrow(
      /unknown EMAIL_TRANSPORT/,
    );
  });

  // ---- Reply-to and from override -----------------------------------------

  it('honours SENDGRID_FROM and SENDGRID_REPLY_TO env overrides', async () => {
    process.env.EMAIL_TRANSPORT = 'sendgrid';
    process.env.SENDGRID_API_KEY = 'SG.test_key';
    process.env.SENDGRID_FROM = 'override@strictons.com';
    process.env.SENDGRID_REPLY_TO = 'reply@strictons.com';

    const { sendMagicLink } = await import('../src/send');
    await sendMagicLink({ to: 'bob@example.test', link: 'https://x' });

    const payload = sgSendMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.from).toBe('override@strictons.com');
    expect(payload.replyTo).toBe('reply@strictons.com');
  });
});
