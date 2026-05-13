/**
 * Plain-text fallback for the staff-triggered portal-access-link resend
 * (Phase 5, Surface 2).
 *
 * Real plain-text, not HTML stripped of tags. Email clients that can't
 * render HTML (or where the user has set "prefer plain text") see this.
 *
 * The link is on its own line so most email clients auto-linkify it.
 */

export type HotelAdminResendTextInput = {
  link: string;
  expiresInMinutes: number;
  hotelName: string;
};

export function renderHotelAdminResendText(input: HotelAdminResendTextInput): string {
  const { link, expiresInMinutes, hotelName } = input;
  return [
    'Sign in to the Strictons hotel portal',
    '',
    `Sign in to the Strictons hotel portal for ${hotelName}.`,
    '',
    'Click the link below to sign in:',
    link,
    '',
    `This link expires in ${expiresInMinutes} minutes.`,
    '',
    "If you didn't request this email, you can safely ignore it.",
    '',
    '— Strictons',
  ].join('\n');
}
