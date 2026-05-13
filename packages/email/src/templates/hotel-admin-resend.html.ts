/**
 * Hand-rolled HTML for the staff-triggered portal-access-link resend
 * (Phase 5, Surface 2).
 *
 * Routine resend — sent when Strictons staff clicks "Resend portal
 * access link" against an existing hotel_users row. The recipient
 * already has a relationship with the portal; the copy is utilitarian
 * ("sign in to the Strictons hotel portal for {hotelName}") rather
 * than a fresh welcome.
 *
 * Hand-rolled rather than @react-email/components per the Phase 3
 * gotcha (1.0.x is npm-deprecated). Same structural shape as
 * magic-link.html.ts and hotel-admin-invite.html.ts; copy differs.
 *
 * Conventions match the sibling templates: inline styles only,
 * table-based layout, no <img> / <style> tags, neutral palette,
 * subject as a sibling export.
 */

export const HOTEL_ADMIN_RESEND_SUBJECT = 'Sign in to the Strictons hotel portal';

export type HotelAdminResendHtmlInput = {
  link: string;
  expiresInMinutes: number;
  hotelName: string;
};

export function renderHotelAdminResendHtml(input: HotelAdminResendHtmlInput): string {
  const { link, expiresInMinutes, hotelName } = input;
  const safeLinkAttr = escapeHtmlAttr(link);
  const safeLinkText = escapeHtmlText(link);
  const safeHotelName = escapeHtmlText(hotelName);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in to the Strictons hotel portal</title>
  </head>
  <body style="margin: 0; padding: 0; background: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f4f4f4;">
      <tr>
        <td align="center" style="padding: 40px 16px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width: 480px; background: #ffffff; border-radius: 8px;">
            <tr>
              <td style="padding: 32px 32px 8px 32px;">
                <h1 style="margin: 0 0 16px 0; font-size: 20px; line-height: 1.3; font-weight: 600; color: #111;">Sign in to the Strictons hotel portal</h1>
                <p style="margin: 0 0 12px 0; font-size: 15px; line-height: 1.5; color: #555;">Sign in to the Strictons hotel portal for <strong style="color: #111;">${safeHotelName}</strong>.</p>
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
