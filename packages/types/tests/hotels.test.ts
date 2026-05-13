import { describe, expect, it } from 'vitest';
import {
  HOTEL_APPROVAL_STATES,
  HOTEL_LEGAL_TRANSITIONS,
  HOTEL_SLUG_REGEX,
  HotelBaseInputSchema,
  HotelCreateInputSchema,
  HotelUpdateInputSchema,
  isLegalTransition,
  type HotelApprovalState,
} from '../src/hotels';

const validBase = {
  name: 'Beachcomber Hotel',
  slug: 'beachcomber',
  contact_email: 'reception@beachcomber.test',
  approval_state: 'pending_design_meeting' as const,
  custom_domain: null,
};

describe('HOTEL_APPROVAL_STATES', () => {
  it('contains exactly the eleven states from migration 1', () => {
    expect(HOTEL_APPROVAL_STATES).toHaveLength(11);
    expect(HOTEL_APPROVAL_STATES[0]).toBe('pending_design_meeting');
    expect(HOTEL_APPROVAL_STATES[HOTEL_APPROVAL_STATES.length - 1]).toBe('distributing');
  });

  it('every state has a transitions entry (including terminal ones with [])', () => {
    for (const state of HOTEL_APPROVAL_STATES) {
      expect(HOTEL_LEGAL_TRANSITIONS[state]).toBeDefined();
    }
  });

  it('distributing is terminal (no outbound transitions)', () => {
    expect(HOTEL_LEGAL_TRANSITIONS.distributing).toEqual([]);
  });
});

describe('HOTEL_SLUG_REGEX', () => {
  it.each([
    ['beachcomber', true],
    ['city-collins', true],
    ['a1', true],
    ['hotel-2026', true],
    ['UPPERCASE', false],
    ['-leading-hyphen', false],
    ['trailing-hyphen-', false],
    // single-char "a" DOES match the regex alone — length is checked by
    // .min(2) on the zod schema separately; regex covers character set
    // + edge-character rules only.
    ['a', true],
    ['has_underscore', false],
    ['has space', false],
    ['has/slash', false],
    ['', false],
  ])('HOTEL_SLUG_REGEX matches %j === %s', (input, expected) => {
    expect(HOTEL_SLUG_REGEX.test(input)).toBe(expected);
  });
});

describe('isLegalTransition', () => {
  it('returns true for documented transitions', () => {
    expect(isLegalTransition('pending_design_meeting', 'design_meeting_held')).toBe(true);
    expect(isLegalTransition('in_print', 'distributing')).toBe(true);
    expect(isLegalTransition('candidate_list_with_hotel', 'paused_awaiting_hotel_response')).toBe(
      true,
    );
  });

  it('returns true for no-op (same state) — staff editing other fields without changing state', () => {
    expect(isLegalTransition('pending_design_meeting', 'pending_design_meeting')).toBe(true);
  });

  it('returns false for undocumented transitions — surfaces the UI warning', () => {
    // Skipping the candidate list step:
    expect(isLegalTransition('design_meeting_held', 'businesses_pitching')).toBe(false);
    // Going backwards:
    expect(isLegalTransition('in_print', 'design_meeting_held')).toBe(false);
    // Outbound from terminal state:
    expect(isLegalTransition('distributing', 'in_print')).toBe(false);
  });
});

describe('HotelCreateInputSchema', () => {
  it('accepts a fully populated base payload', () => {
    expect(() => HotelCreateInputSchema.parse(validBase)).not.toThrow();
  });

  it('accepts custom_domain set to a real string', () => {
    expect(() =>
      HotelCreateInputSchema.parse({ ...validBase, custom_domain: 'guide.example.com' }),
    ).not.toThrow();
  });

  it('rejects empty name', () => {
    expect(() => HotelCreateInputSchema.parse({ ...validBase, name: '   ' })).toThrow();
  });

  it('rejects malformed slug', () => {
    expect(() => HotelCreateInputSchema.parse({ ...validBase, slug: 'UPPERCASE' })).toThrow();
  });

  it('rejects malformed email', () => {
    expect(() =>
      HotelCreateInputSchema.parse({ ...validBase, contact_email: 'not-an-email' }),
    ).toThrow();
  });

  it('rejects approval_state outside the enum', () => {
    expect(() =>
      HotelCreateInputSchema.parse({ ...validBase, approval_state: 'archived' }),
    ).toThrow();
  });

  it('parses every documented approval_state', () => {
    for (const state of HOTEL_APPROVAL_STATES) {
      const result = HotelCreateInputSchema.parse({
        ...validBase,
        approval_state: state satisfies HotelApprovalState,
      });
      expect(result.approval_state).toBe(state);
    }
  });
});

describe('HotelUpdateInputSchema', () => {
  const id = '11111111-1111-4111-8111-111111111111';

  it('requires id', () => {
    expect(() => HotelUpdateInputSchema.parse({})).toThrow();
  });

  it('accepts id-only payload (no fields changed)', () => {
    expect(() => HotelUpdateInputSchema.parse({ id })).not.toThrow();
  });

  it('accepts a partial update (only approval_state)', () => {
    expect(() =>
      HotelUpdateInputSchema.parse({ id, approval_state: 'design_meeting_held' }),
    ).not.toThrow();
  });

  it('does NOT accept slug (immutable per the migration trigger)', () => {
    const parsed = HotelUpdateInputSchema.parse({ id, slug: 'newslug' });
    // slug is omitted from HotelUpdateInputSchema. Zod strips unknown
    // keys by default, so the result has no slug field at runtime.
    expect((parsed as { slug?: string }).slug).toBeUndefined();
  });

  it('accepts custom_domain: null to clear', () => {
    expect(() => HotelUpdateInputSchema.parse({ id, custom_domain: null })).not.toThrow();
  });

  it('rejects malformed id', () => {
    expect(() => HotelUpdateInputSchema.parse({ id: 'not-a-uuid' })).toThrow();
  });
});

describe('HotelBaseInputSchema (shape sanity)', () => {
  it('strips unknown keys by default', () => {
    const result = HotelBaseInputSchema.parse({ ...validBase, somethingElse: 'ignored' });
    expect((result as { somethingElse?: string }).somethingElse).toBeUndefined();
  });
});
