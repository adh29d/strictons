import { test, expect } from '@playwright/test';
import { createServiceRoleClient } from '@strictons/db/client';
import { signInWithMagicLink } from './helpers/magic-link';

/**
 * Phase 6 commit 8 — admin-side candidate-list UI E2E.
 *
 * Single-app spec (admin only — no cross-app navigation). A fresh
 * staff user + hotel are provisioned in beforeAll; the hotel starts in
 * candidate_list_drafted so the mark-ready control is reachable.
 *
 * Coverage (PHASE_6_PLAN.md §9.3):
 *   - staff signs in, navigates to /hotels/<id>/candidates
 *   - manual add → row appears
 *   - remove → row disappears from the alive view
 *   - mark ready for review → list status changes, mark-ready control
 *     replaced by the reopen control
 *   - reopen to drafted → list status changes back
 *   - Google Places search: POST /api/places/search is intercepted at
 *     the network layer (page.route) — no real Google call in CI. The
 *     real upstream is exercised only by manual verification on the
 *     Vercel preview; the add-from-result path's server-side
 *     getPlaceDetails can't be page.route-mocked and is covered by the
 *     commit-6 unit tests.
 *   - CSV upload: a 2-valid-1-invalid fixture → imported 2, rejected 1,
 *     the rejection visible in the UI
 *
 * Race resolution (Phase 4 lock): each Server Action's role="status"
 * (or the revalidated table state) is the deterministic post-action
 * signal — the spec waits on visible text, never page.waitForTimeout.
 *
 * Fixture isolation: fresh staff user + hotel per run, suffixed with
 * Date.now() + a random string. afterAll bans the staff auth user via
 * banned_until≈2099 (audit_log append-only + ON DELETE SET NULL FKs
 * make audited rows effectively immutable — Phase 4 locked decision).
 */

/**
 * 2-valid + 1-invalid CSV, passed inline to setInputFiles as a buffer
 * (no on-disk fixture, no __dirname derivation). "Bad Cafe" has an
 * unparseable website → CsvRowSchema rejects it → imported 2,
 * rejected 1.
 */
const SAMPLE_CSV = [
  'name,website',
  'Good Cafe One,https://one.example',
  'Good Cafe Two,https://two.example',
  'Bad Cafe,not-a-url',
  '',
].join('\n');

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

test.describe('admin candidate-list UI', () => {
  let staffEmail: string;
  let staffUserId: string;
  let hotelId: string;
  let hotelName: string;

  test.beforeAll(async () => {
    const ts = Date.now();
    const suffix = randomSuffix();
    staffEmail = `e2e-cand-staff-${ts}-${suffix}@example.test`;
    hotelName = `E2E Candidate Hotel ${ts}-${suffix}`;

    const service = createServiceRoleClient();

    const { data: staffAuth, error: staffErr } = await service.auth.admin.createUser({
      email: staffEmail,
      email_confirm: true,
    });
    if (staffErr || !staffAuth.user) {
      throw staffErr ?? new Error('beforeAll: staff auth.admin.createUser returned no user');
    }
    staffUserId = staffAuth.user.id;

    const { error: promoteErr } = await service
      .from('strictons_staff')
      .insert({ user_id: staffUserId });
    if (promoteErr) throw promoteErr;

    // Start the hotel in candidate_list_drafted so the mark-ready
    // control is reachable from the first navigation.
    const { data: hotelRow, error: hotelErr } = await service
      .from('hotels')
      .insert({
        slug: `e2e-cand-${ts}-${suffix}`,
        name: hotelName,
        contact_email: `contact-${ts}-${suffix}@example.test`,
        approval_state: 'candidate_list_drafted',
      })
      .select('id')
      .single();
    if (hotelErr || !hotelRow) {
      throw hotelErr ?? new Error('beforeAll: hotel insert returned no id');
    }
    hotelId = hotelRow.id;
  });

  test.afterAll(async () => {
    const service = createServiceRoleClient();
    if (staffUserId) {
      await service.auth.admin.updateUserById(staffUserId, { ban_duration: '876600h' });
    }
    // Hotel + candidate rows + strictons_staff row remain — audit_log
    // append-only blocks hard delete on audited rows. Fresh suffixes
    // per run avoid collisions.
  });

  test('manual add / remove / mark-ready / reopen / Google search / CSV upload', async ({
    page,
    request,
  }) => {
    await signInWithMagicLink({ page, request, email: staffEmail });

    // ---- Navigate to the candidate-list page ----------------------------
    await page.goto(`/hotels/${hotelId}`);
    await page.getByRole('link', { name: 'Open the candidate list' }).click();
    await page.waitForURL(`**/hotels/${hotelId}/candidates`);
    await expect(page.getByRole('heading', { name: 'Candidate list' })).toBeVisible();
    await expect(page.getByText('List status: Draft — staff building the list')).toBeVisible();

    // ---- Manual add → row appears ---------------------------------------
    const manualSection = page.locator('section', { hasText: 'Add a candidate manually' });
    await manualSection.getByLabel('Business name').fill('Manual Test Cafe');
    await manualSection.getByRole('button', { name: 'Add candidate' }).click();
    await expect(
      manualSection.getByRole('status').filter({ hasText: 'Candidate added.' }),
    ).toBeVisible();

    const listSection = page.locator('section', { hasText: 'Current candidates' });
    const manualRow = listSection.getByRole('listitem').filter({ hasText: 'Manual Test Cafe' });
    await expect(manualRow).toBeVisible();

    // ---- Remove → row disappears from the alive view --------------------
    await manualRow.getByRole('button', { name: 'Remove', exact: true }).click();
    await manualRow.getByRole('button', { name: 'Remove Manual Test Cafe' }).click();
    await expect(
      listSection.getByRole('listitem').filter({ hasText: 'Manual Test Cafe' }),
    ).toHaveCount(0);

    // ---- Google Places search: intercept the Route Handler --------------
    await page.route('**/api/places/search', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          results: [
            {
              placeId: 'ChIJ_e2e_mock_1',
              name: 'Mocked Pier Cafe',
              formattedAddress: '1 Pier Rd, Sydney NSW',
              primaryType: 'cafe',
            },
          ],
        }),
      });
    });
    const googleSection = page.locator('section', { hasText: 'Search Google Places' });
    await googleSection.getByLabel('Search query').fill('coffee near the pier');
    await expect(googleSection.getByText('Mocked Pier Cafe')).toBeVisible();
    await page.unroute('**/api/places/search');

    // ---- CSV upload: 2 valid + 1 invalid --------------------------------
    const csvSection = page.locator('section', { hasText: 'Bulk upload from CSV' });
    await csvSection.getByLabel('CSV file').setInputFiles({
      name: 'candidates-sample.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(SAMPLE_CSV, 'utf8'),
    });
    await csvSection.getByRole('button', { name: 'Upload CSV' }).click();
    await expect(
      csvSection
        .getByRole('status')
        .filter({ hasText: 'Imported 2 candidates; 1 rows had errors and were skipped.' }),
    ).toBeVisible();
    // The rejected row surfaces in the UI with its row number.
    await expect(csvSection.getByText(/Row 4:/)).toBeVisible();
    // The 2 valid rows are now in the candidate list.
    await expect(
      listSection.getByRole('listitem').filter({ hasText: 'Good Cafe One' }),
    ).toBeVisible();
    await expect(
      listSection.getByRole('listitem').filter({ hasText: 'Good Cafe Two' }),
    ).toBeVisible();

    // ---- Mark ready for review → status changes -------------------------
    // The deterministic post-action signal for a list-state transition is
    // the page-header status badge, NOT the form's role="status" message:
    // on a successful transition the action's revalidatePath flips
    // hotels.approval_state, so ListStateControls swaps MarkReadyForm out
    // for ReopenForm — MarkReadyForm's useActionState success message
    // unmounts with it (it only flashes). The header badge re-renders via
    // the same revalidate and persists, so the spec keys on that.
    const statusSection = page.locator('section', { hasText: 'List status' });
    await statusSection.getByRole('button', { name: 'Mark ready for hotel review' }).click();
    await expect(page.getByText('List status: With hotel for review')).toBeVisible();

    // ---- Reopen to drafted → status changes back ------------------------
    // After mark-ready the reopen control is rendered (state is
    // candidate_list_with_hotel); its target selector defaults to
    // candidate_list_drafted. Same signal as above — the header badge.
    await statusSection.getByRole('button', { name: 'Reopen list' }).click();
    await expect(page.getByText('List status: Draft — staff building the list')).toBeVisible();

    // ---- DB assertions ---------------------------------------------------
    const service = createServiceRoleClient();
    const { data: aliveRows } = await service
      .from('candidate_businesses')
      .select('name, source, status')
      .eq('hotel_id', hotelId)
      .is('removed_at', null);
    const aliveNames = (aliveRows ?? []).map((r) => r.name).sort();
    expect(aliveNames).toEqual(['Good Cafe One', 'Good Cafe Two']);
    for (const row of aliveRows ?? []) {
      expect(row.source).toBe('csv');
      expect(row.status).toBe('proposed');
    }

    const { data: removedRow } = await service
      .from('candidate_businesses')
      .select('status, removed_at, removed_by')
      .eq('hotel_id', hotelId)
      .eq('name', 'Manual Test Cafe')
      .maybeSingle();
    expect(removedRow?.status).toBe('removed_by_strictons');
    expect(removedRow?.removed_at).not.toBeNull();
    expect(removedRow?.removed_by).toBe(staffUserId);

    const { data: finalHotel } = await service
      .from('hotels')
      .select('approval_state')
      .eq('id', hotelId)
      .single();
    expect(finalHotel?.approval_state).toBe('candidate_list_drafted');
  });
});
