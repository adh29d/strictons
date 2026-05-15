import { describe, expect, it } from 'vitest';
import {
  AddFromGooglePlacesInputSchema,
  ApproveCandidateListInputSchema,
  CANDIDATE_SOURCES,
  CANDIDATE_STATUSES,
  CsvRowSchema,
  CsvUploadInputSchema,
  GooglePlacesSearchInputSchema,
  ManualCandidateInputSchema,
  MarkListReadyForReviewInputSchema,
  RemoveCandidateInputSchema,
  ReopenCandidateListInputSchema,
} from '../src/candidates';

const HOTEL_ID = '11111111-1111-4111-8111-111111111111';
const CANDIDATE_ID = '22222222-2222-4222-8222-222222222222';

describe('CANDIDATE_SOURCES', () => {
  it('contains exactly the three sources from the candidate_source enum', () => {
    expect(CANDIDATE_SOURCES).toEqual(['google_places', 'csv', 'manual']);
  });
});

describe('CANDIDATE_STATUSES', () => {
  it('matches the candidate_status enum order, with removed_by_strictons last', () => {
    // Order mirrors pg_enum.enumsortorder: removed_by_strictons was
    // appended by migration 15 without BEFORE/AFTER, so it sorts last.
    expect(CANDIDATE_STATUSES).toEqual([
      'proposed',
      'approved',
      'removed_by_hotel',
      'signed_to_placement',
      'removed_by_strictons',
    ]);
  });

  it('places removed_by_strictons after signed_to_placement (post-drift-fix order)', () => {
    expect(CANDIDATE_STATUSES.indexOf('removed_by_strictons')).toBeGreaterThan(
      CANDIDATE_STATUSES.indexOf('signed_to_placement'),
    );
  });
});

describe('ManualCandidateInputSchema', () => {
  const validMinimal = { hotelId: HOTEL_ID, name: 'Cafe Mike' };
  const validFull = {
    hotelId: HOTEL_ID,
    name: 'Cafe Mike',
    address: '1 Beach Rd',
    category: 'cafe',
    phone: '+61 2 1234 5678',
    website: 'https://cafemike.example',
    contactEmail: 'hello@cafemike.example',
    distanceM: 350,
  };

  it('accepts a minimal payload (hotelId + name only)', () => {
    expect(() => ManualCandidateInputSchema.parse(validMinimal)).not.toThrow();
  });

  it('accepts a fully populated payload', () => {
    expect(() => ManualCandidateInputSchema.parse(validFull)).not.toThrow();
  });

  it('accepts explicit null for every optional field', () => {
    expect(() =>
      ManualCandidateInputSchema.parse({
        hotelId: HOTEL_ID,
        name: 'Cafe Mike',
        address: null,
        category: null,
        phone: null,
        website: null,
        contactEmail: null,
        distanceM: null,
      }),
    ).not.toThrow();
  });

  it('trims name and rejects whitespace-only name', () => {
    expect(() => ManualCandidateInputSchema.parse({ ...validMinimal, name: '   ' })).toThrow();
  });

  it('rejects a malformed hotelId', () => {
    expect(() =>
      ManualCandidateInputSchema.parse({ ...validMinimal, hotelId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('rejects a name longer than 200 characters', () => {
    expect(() =>
      ManualCandidateInputSchema.parse({ ...validMinimal, name: 'x'.repeat(201) }),
    ).toThrow();
  });

  it('rejects a non-URL website', () => {
    expect(() => ManualCandidateInputSchema.parse({ ...validFull, website: 'cafemike' })).toThrow();
  });

  it('rejects a malformed contactEmail', () => {
    expect(() =>
      ManualCandidateInputSchema.parse({ ...validFull, contactEmail: 'not-an-email' }),
    ).toThrow();
  });

  it('rejects a negative distanceM', () => {
    expect(() => ManualCandidateInputSchema.parse({ ...validFull, distanceM: -1 })).toThrow();
  });

  it('rejects a non-integer distanceM', () => {
    expect(() => ManualCandidateInputSchema.parse({ ...validFull, distanceM: 12.5 })).toThrow();
  });

  it('rejects a distanceM above the 50_000 cap', () => {
    expect(() => ManualCandidateInputSchema.parse({ ...validFull, distanceM: 50_001 })).toThrow();
  });

  it('strips unknown keys', () => {
    const result = ManualCandidateInputSchema.parse({ ...validMinimal, sneaky: 'ignored' });
    expect((result as { sneaky?: string }).sneaky).toBeUndefined();
  });
});

describe('GooglePlacesSearchInputSchema', () => {
  it('accepts a valid query + hotelId', () => {
    expect(() =>
      GooglePlacesSearchInputSchema.parse({ query: 'coffee near pier', hotelId: HOTEL_ID }),
    ).not.toThrow();
  });

  it('rejects a query shorter than 2 characters', () => {
    expect(() => GooglePlacesSearchInputSchema.parse({ query: 'a', hotelId: HOTEL_ID })).toThrow();
  });

  it('rejects a query longer than 200 characters', () => {
    expect(() =>
      GooglePlacesSearchInputSchema.parse({ query: 'x'.repeat(201), hotelId: HOTEL_ID }),
    ).toThrow();
  });

  it('trims the query before length validation (whitespace-padded short query rejected)', () => {
    expect(() =>
      GooglePlacesSearchInputSchema.parse({ query: '  a  ', hotelId: HOTEL_ID }),
    ).toThrow();
  });

  it('rejects a malformed hotelId', () => {
    expect(() =>
      GooglePlacesSearchInputSchema.parse({ query: 'coffee', hotelId: 'nope' }),
    ).toThrow();
  });
});

describe('AddFromGooglePlacesInputSchema', () => {
  const valid = { hotelId: HOTEL_ID, placeId: 'ChIJabc123' };

  it('accepts hotelId + placeId', () => {
    expect(() => AddFromGooglePlacesInputSchema.parse(valid)).not.toThrow();
  });

  it('accepts an optional category override', () => {
    expect(() =>
      AddFromGooglePlacesInputSchema.parse({ ...valid, category: 'restaurant' }),
    ).not.toThrow();
  });

  it('accepts category: null', () => {
    expect(() => AddFromGooglePlacesInputSchema.parse({ ...valid, category: null })).not.toThrow();
  });

  it('rejects an empty placeId', () => {
    expect(() => AddFromGooglePlacesInputSchema.parse({ ...valid, placeId: '' })).toThrow();
  });

  it('rejects a placeId longer than 255 characters', () => {
    expect(() =>
      AddFromGooglePlacesInputSchema.parse({ ...valid, placeId: 'x'.repeat(256) }),
    ).toThrow();
  });

  it('rejects a malformed hotelId', () => {
    expect(() =>
      AddFromGooglePlacesInputSchema.parse({ ...valid, hotelId: 'not-a-uuid' }),
    ).toThrow();
  });
});

describe('CsvRowSchema', () => {
  it('accepts a name-only row (every other column optional)', () => {
    expect(() => CsvRowSchema.parse({ name: 'Cafe Mike' })).not.toThrow();
  });

  it('accepts a fully populated row', () => {
    expect(() =>
      CsvRowSchema.parse({
        name: 'Cafe Mike',
        address: '1 Beach Rd',
        category: 'cafe',
        phone: '+61 2 1234 5678',
        website: 'https://cafemike.example',
        contact_email: 'hello@cafemike.example',
        distance_m: 350,
      }),
    ).not.toThrow();
  });

  it('coerces a string distance_m to a number', () => {
    const result = CsvRowSchema.parse({ name: 'Cafe Mike', distance_m: '350' });
    expect(result.distance_m).toBe(350);
  });

  it('rejects a non-numeric distance_m string', () => {
    expect(() => CsvRowSchema.parse({ name: 'Cafe Mike', distance_m: 'far' })).toThrow();
  });

  it('rejects a non-integer coerced distance_m', () => {
    expect(() => CsvRowSchema.parse({ name: 'Cafe Mike', distance_m: '12.5' })).toThrow();
  });

  it('rejects a whitespace-only name', () => {
    expect(() => CsvRowSchema.parse({ name: '   ' })).toThrow();
  });

  it('rejects a non-URL website', () => {
    expect(() => CsvRowSchema.parse({ name: 'Cafe Mike', website: 'cafemike' })).toThrow();
  });

  it('rejects a malformed contact_email', () => {
    expect(() => CsvRowSchema.parse({ name: 'Cafe Mike', contact_email: 'nope' })).toThrow();
  });

  it('uses snake_case keys (the CSV column-header contract)', () => {
    // contact_email / distance_m, not contactEmail / distanceM — these
    // keys ARE the post-normalisation CSV header names.
    const result = CsvRowSchema.parse({
      name: 'Cafe Mike',
      contact_email: 'hello@cafemike.example',
      distance_m: 100,
    });
    expect(result.contact_email).toBe('hello@cafemike.example');
    expect(result.distance_m).toBe(100);
  });
});

describe('CsvUploadInputSchema', () => {
  it('accepts a valid hotelId', () => {
    expect(() => CsvUploadInputSchema.parse({ hotelId: HOTEL_ID })).not.toThrow();
  });

  it('rejects a malformed hotelId', () => {
    expect(() => CsvUploadInputSchema.parse({ hotelId: 'not-a-uuid' })).toThrow();
  });

  it('rejects a missing hotelId', () => {
    expect(() => CsvUploadInputSchema.parse({})).toThrow();
  });
});

describe('RemoveCandidateInputSchema', () => {
  const valid = { hotelId: HOTEL_ID, candidateId: CANDIDATE_ID };

  it('accepts hotelId + candidateId with no reason', () => {
    expect(() => RemoveCandidateInputSchema.parse(valid)).not.toThrow();
  });

  it('accepts an optional reason', () => {
    expect(() =>
      RemoveCandidateInputSchema.parse({ ...valid, reason: 'permanently closed' }),
    ).not.toThrow();
  });

  it('accepts reason: null', () => {
    expect(() => RemoveCandidateInputSchema.parse({ ...valid, reason: null })).not.toThrow();
  });

  it('rejects a reason longer than 500 characters', () => {
    expect(() => RemoveCandidateInputSchema.parse({ ...valid, reason: 'x'.repeat(501) })).toThrow();
  });

  it('rejects a malformed candidateId', () => {
    expect(() =>
      RemoveCandidateInputSchema.parse({ ...valid, candidateId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('rejects a missing hotelId', () => {
    expect(() => RemoveCandidateInputSchema.parse({ candidateId: CANDIDATE_ID })).toThrow();
  });
});

describe('MarkListReadyForReviewInputSchema', () => {
  it('accepts a valid hotelId', () => {
    expect(() => MarkListReadyForReviewInputSchema.parse({ hotelId: HOTEL_ID })).not.toThrow();
  });

  it('rejects a malformed hotelId', () => {
    expect(() => MarkListReadyForReviewInputSchema.parse({ hotelId: 'nope' })).toThrow();
  });

  it('rejects a missing hotelId', () => {
    expect(() => MarkListReadyForReviewInputSchema.parse({})).toThrow();
  });
});

describe('ApproveCandidateListInputSchema', () => {
  it('accepts a valid hotelId', () => {
    expect(() => ApproveCandidateListInputSchema.parse({ hotelId: HOTEL_ID })).not.toThrow();
  });

  it('rejects a malformed hotelId', () => {
    expect(() => ApproveCandidateListInputSchema.parse({ hotelId: 'nope' })).toThrow();
  });
});

describe('ReopenCandidateListInputSchema', () => {
  it('accepts a reopen to candidate_list_drafted', () => {
    expect(() =>
      ReopenCandidateListInputSchema.parse({
        hotelId: HOTEL_ID,
        targetState: 'candidate_list_drafted',
      }),
    ).not.toThrow();
  });

  it('accepts a reopen to candidate_list_with_hotel', () => {
    expect(() =>
      ReopenCandidateListInputSchema.parse({
        hotelId: HOTEL_ID,
        targetState: 'candidate_list_with_hotel',
      }),
    ).not.toThrow();
  });

  it('accepts an optional reason', () => {
    expect(() =>
      ReopenCandidateListInputSchema.parse({
        hotelId: HOTEL_ID,
        targetState: 'candidate_list_drafted',
        reason: 'hotel asked to add three more businesses',
      }),
    ).not.toThrow();
  });

  it('accepts reason: null', () => {
    expect(() =>
      ReopenCandidateListInputSchema.parse({
        hotelId: HOTEL_ID,
        targetState: 'candidate_list_drafted',
        reason: null,
      }),
    ).not.toThrow();
  });

  it('rejects a targetState outside the two-value enum', () => {
    // candidate_list_approved is a real hotel_approval_state value but is
    // NOT a legal reopen target — reopen moves the list backwards only.
    expect(() =>
      ReopenCandidateListInputSchema.parse({
        hotelId: HOTEL_ID,
        targetState: 'candidate_list_approved',
      }),
    ).toThrow();
  });

  it('rejects a missing targetState', () => {
    expect(() => ReopenCandidateListInputSchema.parse({ hotelId: HOTEL_ID })).toThrow();
  });

  it('rejects a reason longer than 500 characters', () => {
    expect(() =>
      ReopenCandidateListInputSchema.parse({
        hotelId: HOTEL_ID,
        targetState: 'candidate_list_drafted',
        reason: 'x'.repeat(501),
      }),
    ).toThrow();
  });

  it('rejects a malformed hotelId', () => {
    expect(() =>
      ReopenCandidateListInputSchema.parse({
        hotelId: 'nope',
        targetState: 'candidate_list_drafted',
      }),
    ).toThrow();
  });
});
