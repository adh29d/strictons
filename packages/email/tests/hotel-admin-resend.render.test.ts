import { describe, expect, it } from 'vitest';
import { renderHotelAdminResend } from '../src/render';
import {
  HOTEL_ADMIN_RESEND_SUBJECT,
  renderHotelAdminResendHtml,
} from '../src/templates/hotel-admin-resend.html';
import { renderHotelAdminResendText } from '../src/templates/hotel-admin-resend.text';

const FIXTURE_LINK =
  'https://partners.strictons.com/auth/confirm?token_hash=abc123&type=email&next=%2F';
const FIXTURE_LINK_HTML_ESCAPED =
  'https://partners.strictons.com/auth/confirm?token_hash=abc123&amp;type=email&amp;next=%2F';
const FIXTURE_EXPIRY = 15;
const FIXTURE_HOTEL_NAME = 'Test Beachcomber Hotel';

describe('renderHotelAdminResend', () => {
  it('returns subject, html, and text for the given input', () => {
    const result = renderHotelAdminResend({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
      hotelName: FIXTURE_HOTEL_NAME,
    });
    expect(result.subject).toBe(HOTEL_ADMIN_RESEND_SUBJECT);
    expect(result.html).toContain(FIXTURE_LINK_HTML_ESCAPED);
    expect(result.text).toContain(FIXTURE_LINK);
  });

  it('embeds the hotel name verbatim in both html and text', () => {
    const result = renderHotelAdminResend({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
      hotelName: FIXTURE_HOTEL_NAME,
    });
    expect(result.html).toContain(FIXTURE_HOTEL_NAME);
    expect(result.text).toContain(FIXTURE_HOTEL_NAME);
  });

  it('embeds the expiry minutes verbatim in both html and text', () => {
    const result = renderHotelAdminResend({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
      hotelName: FIXTURE_HOTEL_NAME,
    });
    expect(result.html).toContain(`${FIXTURE_EXPIRY} minutes`);
    expect(result.text).toContain(`${FIXTURE_EXPIRY} minutes`);
  });
});

describe('renderHotelAdminResendHtml', () => {
  it('escapes HTML special characters in the link to prevent injection', () => {
    const malicious =
      'https://partners.strictons.com/auth/confirm?token_hash="><script>alert(1)</script>';
    const html = renderHotelAdminResendHtml({
      link: malicious,
      expiresInMinutes: FIXTURE_EXPIRY,
      hotelName: FIXTURE_HOTEL_NAME,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/href="[^"]*"><script>/);
  });

  it('escapes HTML special characters in the hotel name to prevent injection', () => {
    const malicious = '<script>alert(1)</script> & "Co"';
    const html = renderHotelAdminResendHtml({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
      hotelName: malicious,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('renders a button anchor pointing at the link', () => {
    const html = renderHotelAdminResendHtml({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
      hotelName: FIXTURE_HOTEL_NAME,
    });
    expect(html).toMatch(/<a href="[^"]+"[^>]*>Sign in<\/a>/);
  });

  it('renders the fallback link text alongside the button', () => {
    const html = renderHotelAdminResendHtml({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
      hotelName: FIXTURE_HOTEL_NAME,
    });
    expect(html).toContain('Or copy and paste this link');
    expect(html).toContain('https://partners.strictons.com/auth/confirm?token_hash=abc123');
  });

  it('contains no <img> tags (text-first deliverability stance)', () => {
    const html = renderHotelAdminResendHtml({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
      hotelName: FIXTURE_HOTEL_NAME,
    });
    expect(html).not.toMatch(/<img\b/i);
  });

  it('contains no <style> tag (Outlook strips them; we rely on inline styles)', () => {
    const html = renderHotelAdminResendHtml({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
      hotelName: FIXTURE_HOTEL_NAME,
    });
    expect(html).not.toMatch(/<style\b/i);
  });

  it('matches the committed snapshot', () => {
    const html = renderHotelAdminResendHtml({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
      hotelName: FIXTURE_HOTEL_NAME,
    });
    expect(html).toMatchSnapshot();
  });
});

describe('renderHotelAdminResendText', () => {
  it('contains the link on its own line for client auto-linkify', () => {
    const text = renderHotelAdminResendText({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
      hotelName: FIXTURE_HOTEL_NAME,
    });
    expect(text).toContain(`\n${FIXTURE_LINK}\n`);
  });

  it('contains no HTML tags', () => {
    const text = renderHotelAdminResendText({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
      hotelName: FIXTURE_HOTEL_NAME,
    });
    expect(text).not.toMatch(/<[a-z!/]/i);
  });

  it('matches the committed snapshot', () => {
    const text = renderHotelAdminResendText({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
      hotelName: FIXTURE_HOTEL_NAME,
    });
    expect(text).toMatchSnapshot();
  });
});
