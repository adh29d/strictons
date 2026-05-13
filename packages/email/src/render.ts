import { MAGIC_LINK_SUBJECT, renderMagicLinkHtml } from './templates/magic-link.html';
import { renderMagicLinkText } from './templates/magic-link.text';

export type RenderMagicLinkInput = {
  link: string;
  expiresInMinutes: number;
};

export type RenderedMagicLink = {
  subject: string;
  html: string;
  text: string;
};

/**
 * Compose the magic-link email's subject + html + text into a single
 * inert payload the transport layer accepts.
 *
 * Phase 3 has one template, so this function is template-specific. When
 * Phase 4 adds a second template, refactor to a `renderTemplate(name,
 * input)` shape — or keep template-specific renderers, depending on
 * what the second template's input looks like. Resist premature
 * abstraction now.
 */
export function renderMagicLink(input: RenderMagicLinkInput): RenderedMagicLink {
  return {
    subject: MAGIC_LINK_SUBJECT,
    html: renderMagicLinkHtml(input),
    text: renderMagicLinkText(input),
  };
}
