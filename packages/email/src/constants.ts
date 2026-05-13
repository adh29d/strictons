/**
 * Single source of truth for the magic-link expiry window.
 *
 * Consumed by:
 *   - the magic-link email template (commit 6) — embedded in the body
 *     copy as "this link expires in 15 minutes" verbatim
 *   - the partners-app sign-in Server Action (commit 8) — passed to
 *     supabase.auth.admin.generateLink() where applicable, so the
 *     GoTrue-side token TTL matches what the email tells the user
 *
 * Phase 3 plan §10 Q7: 15 minutes for stronger phishing posture vs
 * Supabase's 1-hour default.
 */
export const MAGIC_LINK_EXPIRY_MINUTES = 15;
