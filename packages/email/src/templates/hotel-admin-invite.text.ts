/**
 * Plain-text fallback for the staff-initiated hotel-admin invitation
 * (Phase 5, Surface 1).
 *
 * Real plain-text, not HTML stripped of tags. Email clients that can't
 * render HTML (or where the user has set "prefer plain text") see this.
 *
 * The link is on its own line so most email clients auto-linkify it.
 */

export type HotelAdminInviteTextInput = {
  link: string;
  expiresInMinutes: number;
  hotelName: string;
};

export function renderHotelAdminInviteText(input: HotelAdminInviteTextInput): string {
  const { link, expiresInMinutes, hotelName } = input;
  return [
    "You're invited to the Strictons hotel portal",
    '',
    `You've been added as the admin for ${hotelName} on the Strictons hotel portal.`,
    '',
    'Click the link below to sign in and get started:',
    link,
    '',
    `This link expires in ${expiresInMinutes} minutes.`,
    '',
    "If you didn't expect this email, please reply to let us know.",
    '',
    '— Strictons',
  ].join('\n');
}
