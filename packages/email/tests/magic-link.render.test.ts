import { describe, expect, it } from 'vitest';
import { renderMagicLink } from '../src/render';
import { MAGIC_LINK_SUBJECT, renderMagicLinkHtml } from '../src/templates/magic-link.html';
import { renderMagicLinkText } from '../src/templates/magic-link.text';

const FIXTURE_LINK =
  'https://partners.strictons.com/auth/confirm?token_hash=abc123&type=email&next=%2F';
// Same link with HTML-escaped & for assertions against rendered HTML.
const FIXTURE_LINK_HTML_ESCAPED =
  'https://partners.strictons.com/auth/confirm?token_hash=abc123&amp;type=email&amp;next=%2F';
const FIXTURE_EXPIRY = 15;

describe('renderMagicLink', () => {
  it('returns subject, html, and text for the given input', () => {
    const result = renderMagicLink({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
    });
    expect(result.subject).toBe(MAGIC_LINK_SUBJECT);
    // HTML escapes `&` → `&amp;`; plain-text passes the link through unchanged.
    expect(result.html).toContain(FIXTURE_LINK_HTML_ESCAPED);
    expect(result.text).toContain(FIXTURE_LINK);
  });

  it('embeds the expiry minutes verbatim in both html and text', () => {
    const result = renderMagicLink({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
    });
    expect(result.html).toContain(`${FIXTURE_EXPIRY} minutes`);
    expect(result.text).toContain(`${FIXTURE_EXPIRY} minutes`);
  });

  it('uses a different expiry value when passed one', () => {
    const result = renderMagicLink({
      link: FIXTURE_LINK,
      expiresInMinutes: 30,
    });
    expect(result.html).toContain('30 minutes');
    expect(result.text).toContain('30 minutes');
    expect(result.html).not.toContain('15 minutes');
    expect(result.text).not.toContain('15 minutes');
  });
});

describe('renderMagicLinkHtml', () => {
  it('escapes HTML special characters in the link to prevent injection', () => {
    const malicious =
      'https://partners.strictons.com/auth/confirm?token_hash="><script>alert(1)</script>';
    const html = renderMagicLinkHtml({
      link: malicious,
      expiresInMinutes: FIXTURE_EXPIRY,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    // The escaped form should appear instead.
    expect(html).toContain('&lt;script&gt;');
    // The closing quote injection must be neutralised in attributes.
    expect(html).not.toMatch(/href="[^"]*"><script>/);
  });

  it('renders a button anchor pointing at the link', () => {
    const html = renderMagicLinkHtml({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
    });
    expect(html).toMatch(/<a href="[^"]+"[^>]*>Sign in<\/a>/);
  });

  it('renders the fallback link text alongside the button', () => {
    const html = renderMagicLinkHtml({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
    });
    expect(html).toContain('Or copy and paste this link');
    expect(html).toContain('https://partners.strictons.com/auth/confirm?token_hash=abc123');
  });

  it('contains no <img> tags (text-first deliverability stance)', () => {
    const html = renderMagicLinkHtml({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
    });
    expect(html).not.toMatch(/<img\b/i);
  });

  it('contains no <style> tag (Outlook strips them; we rely on inline styles)', () => {
    const html = renderMagicLinkHtml({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
    });
    expect(html).not.toMatch(/<style\b/i);
  });

  it('matches the committed snapshot', () => {
    const html = renderMagicLinkHtml({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
    });
    expect(html).toMatchSnapshot();
  });
});

describe('renderMagicLinkText', () => {
  it('contains the link on its own line for client auto-linkify', () => {
    const text = renderMagicLinkText({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
    });
    expect(text).toContain(`\n${FIXTURE_LINK}\n`);
  });

  it('contains no HTML tags', () => {
    const text = renderMagicLinkText({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
    });
    expect(text).not.toMatch(/<[a-z!/]/i);
  });

  it('matches the committed snapshot', () => {
    const text = renderMagicLinkText({
      link: FIXTURE_LINK,
      expiresInMinutes: FIXTURE_EXPIRY,
    });
    expect(text).toMatchSnapshot();
  });
});
