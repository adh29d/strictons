import { describe, expect, it } from 'vitest';
import { parseCandidatesCsv } from './parse-candidates-csv';

describe('parseCandidatesCsv — well-formed input', () => {
  it('parses a fully populated CSV into validated rows', () => {
    const csv = [
      'name,address,category,phone,website,contact_email,distance_m',
      'Beachside Cafe,1 Beach Rd,cafe,+61 2 1234 5678,https://beachside.example,hi@beachside.example,350',
      'Pier Bar,9 Pier St,bar,+61 2 9876 5432,https://pierbar.example,hello@pierbar.example,600',
    ].join('\n');

    const result = parseCandidatesCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejected).toEqual([]);
    expect(result.rows).toEqual([
      {
        name: 'Beachside Cafe',
        address: '1 Beach Rd',
        category: 'cafe',
        phone: '+61 2 1234 5678',
        website: 'https://beachside.example',
        contact_email: 'hi@beachside.example',
        distance_m: 350,
      },
      {
        name: 'Pier Bar',
        address: '9 Pier St',
        category: 'bar',
        phone: '+61 2 9876 5432',
        website: 'https://pierbar.example',
        contact_email: 'hello@pierbar.example',
        distance_m: 600,
      },
    ]);
  });

  it('accepts a CSV with only the required name column (optional columns absent)', () => {
    const csv = 'name\nBeachside Cafe\nPier Bar\n';

    const result = parseCandidatesCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejected).toEqual([]);
    expect(result.rows).toEqual([{ name: 'Beachside Cafe' }, { name: 'Pier Bar' }]);
  });

  it('handles quoted fields containing commas', () => {
    const csv = ['name,address', '"Cafe, The","1 Beach Rd, Sydney NSW"'].join('\n');

    const result = parseCandidatesCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ name: 'Cafe, The', address: '1 Beach Rd, Sydney NSW' }]);
  });

  it('parses a BOM-prefixed file (the BOM does not break the name column)', () => {
    const csv = '﻿name,phone\nBeachside Cafe,123\n';

    const result = parseCandidatesCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ name: 'Beachside Cafe', phone: '123' }]);
  });

  it('ignores extra columns not in the contract', () => {
    const csv = 'name,phone,unexpected_column\nBeachside Cafe,123,ignored\n';

    const result = parseCandidatesCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ name: 'Beachside Cafe', phone: '123' }]);
    expect((result.rows[0] as Record<string, unknown>).unexpected_column).toBeUndefined();
  });
});

describe('parseCandidatesCsv — header normalisation', () => {
  it.each([
    ['Name', 'capitalised'],
    ['NAME', 'uppercase'],
    [' name ', 'whitespace-padded'],
    ['NaMe', 'mixed-case'],
  ])('accepts a %s header (%s) as the name column', (header) => {
    const csv = `${header},phone\nBeachside Cafe,123\n`;

    const result = parseCandidatesCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ name: 'Beachside Cafe', phone: '123' }]);
  });

  it('normalises every header, not just name (Contact_Email → contact_email)', () => {
    const csv = 'Name,Contact_Email,Distance_M\nBeachside Cafe,hi@beachside.example,350\n';

    const result = parseCandidatesCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { name: 'Beachside Cafe', contact_email: 'hi@beachside.example', distance_m: 350 },
    ]);
  });
});

describe('parseCandidatesCsv — per-row validation (partial success)', () => {
  it('returns valid rows and rejects invalid ones, with spreadsheet rowNumbers', () => {
    const csv = [
      'name,website', // row 1 (header)
      'Good Cafe,https://good.example', // row 2 → valid
      'Bad Cafe,not-a-url', // row 3 → invalid website
      'Another Good,https://ok.example', // row 4 → valid
      ',https://nameless.example', // row 5 → invalid (name empty)
    ].join('\n');

    const result = parseCandidatesCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { name: 'Good Cafe', website: 'https://good.example' },
      { name: 'Another Good', website: 'https://ok.example' },
    ]);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0]).toMatchObject({ rowNumber: 3 });
    expect(result.rejected[0]!.error).toMatch(/website/i);
    expect(result.rejected[1]).toMatchObject({ rowNumber: 5 });
    expect(result.rejected[1]!.error).toMatch(/name/i);
  });

  it('keeps rowNumber aligned with the spreadsheet when a blank line sits between data rows', () => {
    const csv = [
      'name,website', // row 1 (header)
      'Good Cafe,https://good.example', // row 2 → valid
      '', // row 3 → blank, filtered, NOT a rejection
      'Bad Cafe,not-a-url', // row 4 → invalid website
    ].join('\n');

    const result = parseCandidatesCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ name: 'Good Cafe', website: 'https://good.example' }]);
    // The blank row 3 does not appear as a rejection, and Bad Cafe keeps
    // its true spreadsheet row number (4), not a shifted-up 3.
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ rowNumber: 4 });
  });

  it('does not produce a spurious rejection for a trailing newline', () => {
    const csv = 'name\nBeachside Cafe\n';

    const result = parseCandidatesCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ name: 'Beachside Cafe' }]);
    expect(result.rejected).toEqual([]);
  });

  it('rejects a row with an out-of-contract distance_m', () => {
    const csv = 'name,distance_m\nBeachside Cafe,not-a-number\n';

    const result = parseCandidatesCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ rowNumber: 2 });
  });
});

describe('parseCandidatesCsv — fatal cases', () => {
  it('is fatal when the file is empty (zero bytes)', () => {
    const result = parseCandidatesCsv('');
    expect(result).toEqual({ ok: false, error: 'The CSV file is empty.' });
  });

  it('is fatal when the file is whitespace only', () => {
    const result = parseCandidatesCsv('   \n  \n');
    expect(result).toEqual({ ok: false, error: 'The CSV file is empty.' });
  });

  it('is fatal when the file is header-only (no data rows) — distinct from empty', () => {
    const result = parseCandidatesCsv('name,phone\n');
    expect(result).toEqual({ ok: false, error: 'The CSV has no data rows.' });
  });

  it('is fatal when the file is header-only without a trailing newline', () => {
    const result = parseCandidatesCsv('name,phone');
    expect(result).toEqual({ ok: false, error: 'The CSV has no data rows.' });
  });

  it('is fatal when the required name column is missing', () => {
    const csv = 'title,phone\nBeachside Cafe,123\n';
    const result = parseCandidatesCsv(csv);
    expect(result).toEqual({
      ok: false,
      error: "The CSV is missing the required 'name' column.",
    });
  });

  it('is fatal when the file exceeds 1 MiB (checked pre-parse)', () => {
    // 'name\n' header + a single value padded past 1,048,576 bytes.
    const huge = `name\n${'x'.repeat(1_048_577)}\n`;
    expect(Buffer.byteLength(huge, 'utf8')).toBeGreaterThan(1_048_576);

    const result = parseCandidatesCsv(huge);
    expect(result).toEqual({
      ok: false,
      error: 'The CSV file is too large. The maximum size is 1 MB.',
    });
  });

  it('accepts a file at exactly the 500-row cap', () => {
    const rows = Array.from({ length: 500 }, (_, i) => `Cafe ${i}`);
    const csv = `name\n${rows.join('\n')}\n`;

    const result = parseCandidatesCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(500);
  });

  it('is fatal when the file exceeds the 500-row cap', () => {
    const rows = Array.from({ length: 501 }, (_, i) => `Cafe ${i}`);
    const csv = `name\n${rows.join('\n')}\n`;

    const result = parseCandidatesCsv(csv);

    expect(result).toEqual({
      ok: false,
      error: 'The CSV has 501 data rows. The maximum is 500.',
    });
  });

  it('does not count a trailing blank line toward the 500-row cap', () => {
    // 500 real rows + a trailing newline (which yields one empty row that
    // is filtered) must NOT trip the cap.
    const rows = Array.from({ length: 500 }, (_, i) => `Cafe ${i}`);
    const csv = `name\n${rows.join('\n')}\n`; // trailing \n → one empty parsed row

    const result = parseCandidatesCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(500);
  });
});
