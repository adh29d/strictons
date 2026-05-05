/**
 * Plain-text fallback for the magic-link email.
 *
 * Real plain-text, not HTML stripped of tags. Email clients that can't
 * render HTML (or where the user has set "prefer plain text") see this.
 *
 * The link is on its own line so most email clients auto-linkify it.
 */

export type MagicLinkTextInput = {
  link: string;
  expiresInMinutes: number;
};

export function renderMagicLinkText(input: MagicLinkTextInput): string {
  const { link, expiresInMinutes } = input;
  return [
    'Sign in to Strictons partners',
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
