/**
 * Hand-rolled HTML for the magic-link sign-in email.
 *
 * Phase 3 ships a single transactional template. The plan §7 originally
 * recommended @react-email/components for the email-client-quirks tax,
 * but @react-email/components@1.0.x is npm-deprecated with no replacement
 * (gotcha captured in PROJECT_LOG). For one minimal text-and-button
 * email the quirks tax is small — table-based layout with inline styles
 * covers Outlook + Gmail + Apple Mail. Re-evaluate when Phase 4's
 * second template lands.
 *
 * Conventions:
 *   - All styling is inline (style="..."). No <style> tag, no external
 *     CSS — Outlook strips them.
 *   - Outermost layout is a <table> centered with margin: 0 auto;
 *     div+max-width centering doesn't work in Outlook.
 *   - The button is an <a> wrapped in a <table>+<tr>+<td> for Outlook
 *     compatibility (Outlook doesn't honour padding on <a> directly).
 *   - No <img> tags — text-first templates score better with spam
 *     filters and avoid the "images blocked by default" experience.
 *   - Neutral palette (#111 / #555 / #f4f4f4 / white). Auth emails
 *     should look utilitarian, not brand-rich.
 *   - Subject lives alongside as a sibling export so callers
 *     (renderMagicLink) compose subject + html + text in one place.
 */

export const MAGIC_LINK_SUBJECT = 'Sign in to Strictons partners';

export type MagicLinkHtmlInput = {
  link: string;
  expiresInMinutes: number;
};

export function renderMagicLinkHtml(input: MagicLinkHtmlInput): string {
  const { link, expiresInMinutes } = input;
  const safeLinkAttr = escapeHtmlAttr(link);
  const safeLinkText = escapeHtmlText(link);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in to Strictons partners</title>
  </head>
  <body style="margin: 0; padding: 0; background: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f4f4f4;">
      <tr>
        <td align="center" style="padding: 40px 16px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width: 480px; background: #ffffff; border-radius: 8px;">
            <tr>
              <td style="padding: 32px 32px 8px 32px;">
                <h1 style="margin: 0 0 16px 0; font-size: 20px; line-height: 1.3; font-weight: 600; color: #111;">Sign in to Strictons partners</h1>
                <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.5; color: #555;">Click the button below to sign in. This link expires in ${expiresInMinutes} minutes.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 0 32px 24px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="border-radius: 4px; background: #111;">
                      <a href="${safeLinkAttr}" style="display: inline-block; padding: 12px 24px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 4px;">Sign in</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 0 32px 32px 32px;">
                <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.5; color: #555;">Or copy and paste this link into your browser:</p>
                <p style="margin: 0 0 24px 0; font-size: 13px; line-height: 1.5; color: #555; word-break: break-all;"><a href="${safeLinkAttr}" style="color: #111; text-decoration: underline;">${safeLinkText}</a></p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 0 0 16px 0;" />
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #999;">If you didn't request this email, you can safely ignore it.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttr(s: string): string {
  return escapeHtmlText(s).replace(/"/g, '&quot;');
}
