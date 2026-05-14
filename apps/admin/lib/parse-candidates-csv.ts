import Papa from 'papaparse';
import { CsvRowSchema, type CsvRow } from '@strictons/types/candidates';

/**
 * CSV parser for the staff-side candidate-list bulk upload.
 *
 * Server-only by convention (no 'use server' directive, no client
 * import) — matches the apps/admin/lib/require-staff.ts pattern. The
 * uploadCandidateCsv Server Action (commit 7) reads the FormData File
 * via `await file.text()` and passes the resulting string here; no
 * caller is wired yet.
 *
 * Contract (PHASE_6_PLAN.md §7):
 *   - Synchronous papaparse string-parse. delimiter:',' is explicit so
 *     papaparse doesn't emit UndetectableDelimiter noise during auto-
 *     detection. skipEmptyLines:false is explicit and deliberate — see
 *     the rowNumber note below.
 *   - Headers normalised to header.trim().toLowerCase() via papaparse's
 *     transformHeader option (papaparse does NOT normalise by default).
 *     'Name', 'NAME', ' name ' all land on the schema's `name` field.
 *   - Column contract: `name` required; address, category, phone,
 *     website, contact_email, distance_m optional. Extra columns are
 *     ignored (CsvRowSchema strips unknown keys).
 *   - Per-row validation via CsvRowSchema. Valid rows accumulate as
 *     CsvRow[]; invalid rows accumulate as { rowNumber, error }. Both
 *     lists are returned — the Server Action owns the partial-success
 *     semantics.
 *
 * Fatal cases (return { ok: false, error } — the parser refuses to
 * return partial results):
 *   - File larger than 1 MiB (checked pre-parse on the decoded string's
 *     UTF-8 byte length, which equals the original file size; bounds
 *     memory).
 *   - Empty file (zero bytes / whitespace only): "The CSV file is empty."
 *   - Missing the required `name` column: caught before any per-row work.
 *   - Header-only / no data rows: "The CSV has no data rows." — importing
 *     zero candidates is never a meaningful success; a header-only file
 *     is almost always the wrong file or a blank template.
 *   - More than 500 data rows (checked post-parse on the real, non-empty
 *     row count).
 *
 * rowNumber semantics: the rejection rowNumber is the spreadsheet row
 * the user sees in Excel — `dataIndex + 2` (+1 for 1-indexing, +1 for
 * the header row). skipEmptyLines is OFF so every source line keeps its
 * index; entirely-empty lines (a trailing newline, blank rows) are
 * filtered out manually AFTER recording each surviving row's original
 * index, so a mid-file blank line does not shift the rowNumbers of the
 * rows below it.
 */

/** 1 MiB. "1 MB" in the plan; 1,048,576 bytes is the conventional file-size MB. */
const MAX_FILE_BYTES = 1_048_576;
const MAX_DATA_ROWS = 500;

export type CsvRejection = { rowNumber: number; error: string };

export type ParseCandidatesCsvResult =
  | { ok: true; rows: CsvRow[]; rejected: CsvRejection[] }
  | { ok: false; error: string };

/** True when every cell in the row is null/undefined/empty/whitespace. */
function isEntirelyEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every(
    (value) =>
      value === null || value === undefined || (typeof value === 'string' && value.trim() === ''),
  );
}

export function parseCandidatesCsv(content: string): ParseCandidatesCsvResult {
  // Size cap — pre-parse, on the decoded string's UTF-8 byte length.
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
    return { ok: false, error: 'The CSV file is too large. The maximum size is 1 MB.' };
  }

  // Empty file — zero bytes or whitespace only.
  if (content.trim() === '') {
    return { ok: false, error: 'The CSV file is empty.' };
  }

  const parsed = Papa.parse<Record<string, unknown>>(content, {
    header: true,
    delimiter: ',',
    skipEmptyLines: false,
    transformHeader: (header) => header.trim().toLowerCase(),
  });

  const fields = parsed.meta.fields ?? [];

  // Missing required `name` column — fatal, before any per-row work.
  if (!fields.includes('name')) {
    return { ok: false, error: "The CSV is missing the required 'name' column." };
  }

  // Drop entirely-empty source lines while preserving each surviving
  // row's ORIGINAL data index, so rowNumber stays aligned with the
  // spreadsheet even when blank lines sit between data rows.
  const realRows = parsed.data
    .map((row, dataIndex) => ({ row, dataIndex }))
    .filter(({ row }) => !isEntirelyEmpty(row));

  // Header-only / no data rows — fatal.
  if (realRows.length === 0) {
    return { ok: false, error: 'The CSV has no data rows.' };
  }

  // Row-count cap — post-parse, on the real (non-empty) row count.
  if (realRows.length > MAX_DATA_ROWS) {
    return {
      ok: false,
      error: `The CSV has ${realRows.length} data rows. The maximum is ${MAX_DATA_ROWS}.`,
    };
  }

  const rows: CsvRow[] = [];
  const rejected: CsvRejection[] = [];

  for (const { row, dataIndex } of realRows) {
    const rowNumber = dataIndex + 2;
    const result = CsvRowSchema.safeParse(row);
    if (result.success) {
      rows.push(result.data);
    } else {
      const error = result.error.issues
        .map((issue) => `${issue.path.join('.') || '(row)'}: ${issue.message}`)
        .join('; ');
      rejected.push({ rowNumber, error });
    }
  }

  return { ok: true, rows, rejected };
}
