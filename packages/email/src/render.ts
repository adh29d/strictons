import { MAGIC_LINK_SUBJECT, renderMagicLinkHtml } from './templates/magic-link.html';
import { renderMagicLinkText } from './templates/magic-link.text';
import {
  HOTEL_ADMIN_INVITE_SUBJECT,
  renderHotelAdminInviteHtml,
} from './templates/hotel-admin-invite.html';
import { renderHotelAdminInviteText } from './templates/hotel-admin-invite.text';
import {
  HOTEL_ADMIN_RESEND_SUBJECT,
  renderHotelAdminResendHtml,
} from './templates/hotel-admin-resend.html';
import { renderHotelAdminResendText } from './templates/hotel-admin-resend.text';

export type RenderMagicLinkInput = {
  link: string;
  expiresInMinutes: number;
};

/**
 * Output of every per-template render helper. Subject + html + text;
 * the addressed envelope (to / from / replyTo) is composed in send.ts
 * before the transport receives the message. Distinct from
 * `RenderedEmail` in ./transports/types which carries the envelope
 * fields.
 */
export type RenderedTemplate = {
  subject: string;
  html: string;
  text: string;
};

/**
 * Backwards-compatible alias for callers that imported the previous
 * `RenderedMagicLink` name. Both names point at the same shape.
 */
export type RenderedMagicLink = RenderedTemplate;

/**
 * Compose the magic-link email's subject + html + text into a single
 * inert payload the transport layer accepts.
 *
 * Phase 3 has one template, so this function is template-specific. When
 * a second template arrives (Phase 5 adds two), keep template-specific
 * renderers — the inputs differ per template (the hotel-admin invite
 * needs `hotelName`; the generic magic-link does not), and a unified
 * `renderTemplate(name, input)` would either lose type-safety on the
 * input shape or accept a union that's awkward at every call site.
 * Template-specific renderers each keep their typed input contract.
 */
export function renderMagicLink(input: RenderMagicLinkInput): RenderedTemplate {
  return {
    subject: MAGIC_LINK_SUBJECT,
    html: renderMagicLinkHtml(input),
    text: renderMagicLinkText(input),
  };
}

export type RenderHotelAdminInviteInput = {
  link: string;
  expiresInMinutes: number;
  hotelName: string;
};

/**
 * Compose the staff-initiated hotel-admin invitation email
 * (Phase 5, Surface 1). First-touch welcome with "you've been added as
 * admin for {hotelName}" framing.
 */
export function renderHotelAdminInvite(input: RenderHotelAdminInviteInput): RenderedTemplate {
  return {
    subject: HOTEL_ADMIN_INVITE_SUBJECT,
    html: renderHotelAdminInviteHtml(input),
    text: renderHotelAdminInviteText(input),
  };
}

export type RenderHotelAdminResendInput = {
  link: string;
  expiresInMinutes: number;
  hotelName: string;
};

/**
 * Compose the staff-triggered portal-access-link resend email
 * (Phase 5, Surface 2). Routine "sign in to the hotel portal for
 * {hotelName}" copy for an existing hotel admin.
 */
export function renderHotelAdminResend(input: RenderHotelAdminResendInput): RenderedTemplate {
  return {
    subject: HOTEL_ADMIN_RESEND_SUBJECT,
    html: renderHotelAdminResendHtml(input),
    text: renderHotelAdminResendText(input),
  };
}
