import { test, expect } from '@playwright/test';
import { createServiceRoleClient } from '@strictons/db/client';
import { signInWithMagicLink } from './helpers/magic-link';

/**
 * Phase 6 commit 10 — hotel-side candidate-list UI E2E.
 *
 * Single-app spec (partners only — no cross-app navigation; that's
 * commit 11). A fresh hotel admin user + hotel + two seeded candidates
 * are provisioned in beforeAll; the hotel starts in
 * candidate_list_with_hotel so the add/remove/approve surfaces are all
 * reachable on first navigation.
 *
 * Coverage (PHASE_6_PLAN.md §9.3):
 *   - hotel admin signs in via magic link
 *   - lands at /, sees the per-hotel-admin "Candidate list" link
 *   - clicks through to /hotels/<id>/candidates
 *   - sees the seeded candidates
 *   - manual add → row appears, audit landed
 *   - remove → row disappears from default view
 *   - approve modal: Cancel bails out (state unchanged), then Confirm
 *     commits (state moves to candidate_list_approved, mutation
 *     surfaces hide, locked banner shows)
 *
 * Race resolution (Phase 4 lock): each Server Action's role="status"
 * (or the revalidated table / page state) is the deterministic post-
 * action signal — the spec waits on visible text, never
 * page.waitForTimeout. For the approve action specifically — same
 * known rough edge as the admin commit-8 ListStateControls: the
 * inline role="status" success message flashes because the parent
 * Server Component re-renders and the section conditional hides the
 * approve control. The durable signal is the page-header status badge
 * + the locked banner that replaces the form section.
 *
 * Fixture isolation: fresh hotel admin user + hotel + candidates per
 * run, suffixed with Date.now() + a random string. afterAll bans the
 * hotel admin auth user via banned_until≈2099 (audit_log append-only
 * + FKs make audited rows effectively immutable — same Phase 4
 * locked pattern as commit-8's admin spec).
 */

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

test.describe('partners candidate-list UI (hotel admin)', () => {
  let adminEmail: string;
  let adminUserId: string;
  let hotelId: string;
  let hotelName: string;
  let seededCandidateName: string;

  test.beforeAll(async () => {
    const ts = Date.now();
    const suffix = randomSuffix();
    adminEmail = `e2e-cand-hotel-admin-${ts}-${suffix}@example.test`;
    hotelName = `E2E Hotel Candidate ${ts}-${suffix}`;
    seededCandidateName = `Seeded Cafe ${suffix}`;

    const service = createServiceRoleClient();

    // ---- Create the hotel admin auth user ---------------------------------
    const { data: adminAuth, error: adminErr } = await service.auth.admin.createUser({
      email: adminEmail,
      email_confirm: true,
    });
    if (adminErr || !adminAuth.user) {
      throw adminErr ?? new Error('beforeAll: admin auth.admin.createUser returned no user');
    }
    adminUserId = adminAuth.user.id;

    // ---- Create the hotel in candidate_list_with_hotel state --------------
    // This state permits both add/remove and approve, so every surface
    // the spec exercises is reachable from the first navigation.
    const { data: hotelRow, error: hotelErr } = await service
      .from('hotels')
      .insert({
        slug: `e2e-hcand-${ts}-${suffix}`,
        name: hotelName,
        contact_email: `contact-${ts}-${suffix}@example.test`,
        approval_state: 'candidate_list_with_hotel',
      })
      .select('id')
      .single();
    if (hotelErr || !hotelRow) {
      throw hotelErr ?? new Error('beforeAll: hotel insert returned no id');
    }
    hotelId = hotelRow.id;

    // ---- Link admin to the hotel as is_admin via the auto-promote trigger ---
    // The first-invitee auto-promote trigger (Phase 2 baseline) sets
    // is_admin=true on the first hotel_users row per hotel_id. accepted_at
    // is supplied directly so the admin is in the "ready to admin" state
    // from the start; we skip the /auth/confirm reconcile.
    const { error: linkErr } = await service.from('hotel_users').insert({
      hotel_id: hotelId,
      invited_email: adminEmail,
      user_id: adminUserId,
      accepted_at: new Date().toISOString(),
    });
    if (linkErr) throw linkErr;

    // ---- Seed two candidate_businesses rows ------------------------------
    // Service-role bypass — we insert with source='manual' and
    // proposed_by=adminUserId so the rows look like a normal hotel-side
    // add. The spec then exercises a remove on one of them and an add
    // for a third.
    const { error: seedErr } = await service.from('candidate_businesses').insert([
      {
        hotel_id: hotelId,
        source: 'manual',
        name: seededCandidateName,
        proposed_by: adminUserId,
        status: 'proposed',
      },
      {
        hotel_id: hotelId,
        source: 'manual',
        name: `Other Seed ${suffix}`,
        proposed_by: adminUserId,
        status: 'proposed',
      },
    ]);
    if (seedErr) throw seedErr;
  });

  test.afterAll(async () => {
    const service = createServiceRoleClient();
    if (adminUserId) {
      await service.auth.admin.updateUserById(adminUserId, { ban_duration: '876600h' });
    }
    // Hotel + candidate_businesses rows + hotel_users row remain —
    // audit_log append-only blocks hard delete on audited rows. Fresh
    // suffixes per run avoid collisions.
  });

  test('navigate → see seeded list → add / remove / approve (with cancel-then-confirm)', async ({
    page,
    request,
  }) => {
    await signInWithMagicLink({ page, request, email: adminEmail });

    // ---- Landing: per-role candidate-list link is visible ---------------
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Strictons partners' })).toBeVisible();
    await expect(page.getByText(`Hotel admin — ${hotelName}`)).toBeVisible();
    await page.getByRole('link', { name: 'Candidate list' }).click();
    await page.waitForURL(`**/hotels/${hotelId}/candidates`);
    await expect(page.getByRole('heading', { name: 'Candidate list' })).toBeVisible();
    await expect(page.getByText('Status: Ready for your review')).toBeVisible();

    // ---- Seeded rows visible -------------------------------------------
    const listSection = page.locator('section', { hasText: 'Current candidates' });
    await expect(
      listSection.getByRole('listitem').filter({ hasText: seededCandidateName }),
    ).toBeVisible();

    // ---- Manual add → row appears ---------------------------------------
    const addSection = page.locator('section', { hasText: 'Add a candidate' });
    await addSection.getByLabel('Business name').fill('Hotel Manual Add');
    await addSection.getByRole('button', { name: 'Add candidate' }).click();
    await expect(
      addSection.getByRole('status').filter({ hasText: 'Candidate added.' }),
    ).toBeVisible();
    await expect(
      listSection.getByRole('listitem').filter({ hasText: 'Hotel Manual Add' }),
    ).toBeVisible();

    // ---- Remove → row disappears ----------------------------------------
    const seededRow = listSection.getByRole('listitem').filter({ hasText: seededCandidateName });
    await seededRow.getByRole('button', { name: 'Remove', exact: true }).click();
    await seededRow.getByRole('button', { name: `Remove ${seededCandidateName}` }).click();
    await expect(
      listSection.getByRole('listitem').filter({ hasText: seededCandidateName }),
    ).toHaveCount(0);

    // ---- Approve list: cancel first, then confirm -----------------------
    const approveSection = page.locator('section', { hasText: 'Approve your list' });
    await approveSection.getByRole('button', { name: 'Approve list' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("won't be able to add or remove candidates");
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    // State unchanged after cancel — status badge still "Ready for your review".
    await expect(page.getByText('Status: Ready for your review')).toBeVisible();

    // Now confirm. The dialog's "Approve list" button is inside the
    // form, so clicking it submits the approveCandidateList action.
    await approveSection.getByRole('button', { name: 'Approve list' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve list' }).click();

    // Durable post-action signal: page-header status badge flips, locked
    // banner replaces the mutation surfaces. The inline role="status"
    // success message is transient (the ApproveListControls section
    // unmounts on revalidate — known small UX rough edge per the
    // commit-8 ListStateControls pattern).
    await expect(page.getByText('Status: Approved')).toBeVisible();
    await expect(page.getByText('Your candidate list is approved.')).toBeVisible();

    // The mutation surfaces are gone.
    await expect(page.locator('section', { hasText: 'Add a candidate' })).toHaveCount(0);
    await expect(page.locator('section', { hasText: 'Approve your list' })).toHaveCount(0);

    // ---- DB assertions --------------------------------------------------
    const service = createServiceRoleClient();
    const { data: aliveRows } = await service
      .from('candidate_businesses')
      .select('name, source, status, proposed_by')
      .eq('hotel_id', hotelId)
      .is('removed_at', null);
    const aliveNames = (aliveRows ?? []).map((r) => r.name).sort();
    expect(aliveNames).toContain('Hotel Manual Add');
    expect(aliveNames).not.toContain(seededCandidateName);
    const manualAddRow = (aliveRows ?? []).find((r) => r.name === 'Hotel Manual Add');
    expect(manualAddRow?.source).toBe('manual');
    expect(manualAddRow?.proposed_by).toBe(adminUserId);

    const { data: removedRow } = await service
      .from('candidate_businesses')
      .select('status, removed_at, removed_by')
      .eq('hotel_id', hotelId)
      .eq('name', seededCandidateName)
      .maybeSingle();
    expect(removedRow?.status).toBe('removed_by_hotel');
    expect(removedRow?.removed_at).not.toBeNull();
    expect(removedRow?.removed_by).toBe(adminUserId);

    const { data: finalHotel } = await service
      .from('hotels')
      .select('approval_state, candidate_list_approved_at')
      .eq('id', hotelId)
      .single();
    expect(finalHotel?.approval_state).toBe('candidate_list_approved');
    expect(finalHotel?.candidate_list_approved_at).not.toBeNull();
  });
});
