import { test, expect } from '@playwright/test';
import { createServiceRoleClient } from '@strictons/db/client';
import { signInWithMagicLink } from './helpers/magic-link';

/**
 * Hotel invite + revoke flow E2E.
 *
 * Phase 3 covered the request → consume → /no-access → sign-out path
 * for a fresh email with no membership. This spec covers the
 * membership lifecycle on top of that:
 *
 *   1. Admin (seeded via service-role beforeAll) signs in
 *   2. Admin invites a fresh email via /members
 *   3. Invitee separately requests a magic link and signs in
 *      (/auth/confirm reconciles the invite, lifting user_id IS NULL
 *      to the invitee's auth id via the service-role reconcile path)
 *   4. Admin reloads /members — invitee row now shows accepted state
 *   5. Admin revokes invitee. Native window.confirm is auto-accepted
 *      via Playwright's dialog handler.
 *   6. Invitee navigates to a protected route — middleware reads
 *      empty active memberships (revoked filter) and redirects to
 *      /no-access. Membership-level revoke is enforced regardless of
 *      whether the Supabase JWT is still technically valid.
 *
 * Scope choice — "revoke before accept" is NOT covered here. Its code
 * path is the same revokeMember Server Action; Phase 3's unit tests
 * (members/actions.test.ts) exercise both branches. [FOLLOWUP] tag
 * for Phase 5 to add an E2E case for pre-accept revoke if a real
 * regression surfaces in production.
 *
 * Fixture isolation
 *
 * Each run creates a fresh hotel + fresh admin email + fresh invitee
 * email (all suffixed Date.now()). The first-invitee auto-promote
 * trigger fires on the hotel_users INSERT in beforeAll, so the admin
 * row is is_admin=true without an explicit set (which the column
 * GRANT would refuse anyway per Phase 3 migration 14).
 *
 * Cleanup is implicit — CI's db reset wipes the DB before every run.
 * Locally, accumulated rows are harmless: future runs use fresh
 * timestamps and don't collide.
 */

const HOTEL_ADMIN_BUTTON_LABEL = 'Revoke';

test.describe('partners invite + revoke', () => {
  let adminEmail: string;
  let inviteeEmail: string;
  let hotelId: string;

  test.beforeAll(async () => {
    const ts = Date.now();
    adminEmail = `e2e-admin-${ts}@example.test`;
    inviteeEmail = `e2e-invitee-${ts}@example.test`;

    const service = createServiceRoleClient();

    // ---- Create the admin auth user ---------------------------------------
    const { data: adminAuth, error: adminErr } = await service.auth.admin.createUser({
      email: adminEmail,
      email_confirm: true,
    });
    if (adminErr || !adminAuth.user) {
      throw adminErr ?? new Error('beforeAll: admin auth.admin.createUser returned no user');
    }
    const adminUserId = adminAuth.user.id;

    // ---- Create a fresh hotel ---------------------------------------------
    const { data: hotelRow, error: hotelErr } = await service
      .from('hotels')
      .insert({
        slug: `e2e-${ts}`,
        name: `E2E Hotel ${ts}`,
        contact_email: `contact-${ts}@example.test`,
      })
      .select('id')
      .single();
    if (hotelErr || !hotelRow) {
      throw hotelErr ?? new Error('beforeAll: hotel insert returned no id');
    }
    hotelId = hotelRow.id;

    // ---- Link admin to hotel ----------------------------------------------
    // The first-invitee auto-promote trigger (Phase 2 baseline,
    // BEFORE INSERT on hotel_users) sets is_admin=true on the first
    // row per hotel_id. Since this is a fresh hotel, this insert
    // becomes the auto-promoted admin row. accepted_at is supplied
    // directly so the admin is in the "ready to admin" state from
    // the start; we skip the /auth/confirm reconcile that would
    // otherwise set it on first sign-in.
    const { error: linkErr } = await service.from('hotel_users').insert({
      hotel_id: hotelId,
      invited_email: adminEmail,
      user_id: adminUserId,
      accepted_at: new Date().toISOString(),
    });
    if (linkErr) {
      throw linkErr;
    }
  });

  test('invite → accept → revoke → loss of access', async ({ browser, request }) => {
    // ----------------------------------------------------------------------
    // Admin context: sign in, navigate to /members, invite the invitee
    // ----------------------------------------------------------------------
    const adminCtx = await browser.newContext();
    const admin = await adminCtx.newPage();

    await signInWithMagicLink({ page: admin, request, email: adminEmail });

    // Page may have landed on / (placeholder) or another protected route;
    // navigate to /members explicitly with the scope query param.
    await admin.goto(`/members?hotel=${hotelId}`);
    await expect(admin.getByRole('heading', { name: 'Members', exact: true })).toBeVisible();
    await expect(admin.getByText(adminEmail)).toBeVisible();

    // Submit the invite form.
    await admin.getByLabel('Email').fill(inviteeEmail);
    await admin.getByRole('button', { name: 'Send invite' }).click();
    await expect(admin.getByText(/Invite created/i)).toBeVisible();

    // The success message says to reload to see the new row. Confirm the
    // invitee appears in pending state.
    await admin.reload();
    const inviteeRow = admin.getByRole('listitem').filter({ hasText: inviteeEmail });
    await expect(inviteeRow).toBeVisible();
    await expect(inviteeRow.getByText(/Pending/i)).toBeVisible();

    // ----------------------------------------------------------------------
    // Invitee context: separate browser, magic-link sign-in
    // ----------------------------------------------------------------------
    const inviteeCtx = await browser.newContext();
    const invitee = await inviteeCtx.newPage();

    await signInWithMagicLink({ page: invitee, request, email: inviteeEmail });

    // The invite reconcile in /auth/confirm should have flipped user_id
    // on the invitee's hotel_users row. Invitee now has a hotel_user
    // role → middleware allows them onto /, not /no-access.
    await expect(invitee).not.toHaveURL(/\/no-access/);

    // ----------------------------------------------------------------------
    // Admin reload: invitee row now shows accepted state
    // ----------------------------------------------------------------------
    await admin.reload();
    const inviteeRowAccepted = admin.getByRole('listitem').filter({ hasText: inviteeEmail });
    await expect(inviteeRowAccepted.getByText(/accepted/i)).toBeVisible();

    // ----------------------------------------------------------------------
    // Admin revokes the invitee. The RevokeButton uses window.confirm()
    // for a "are you sure" guard; Playwright's auto-dismiss would
    // cancel it, so register a one-shot accept handler before clicking.
    // ----------------------------------------------------------------------
    admin.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await inviteeRowAccepted.getByRole('button', { name: HOTEL_ADMIN_BUTTON_LABEL }).click();

    // The revoke Server Action calls revalidatePath('/members'), so
    // the page re-renders with fresh data as part of the action's
    // response. The reload here is belt-and-braces — it's harmless
    // and protects against any future caching surprise.
    await admin.reload();
    const inviteeRowRevoked = admin.getByRole('listitem').filter({ hasText: inviteeEmail });
    await expect(inviteeRowRevoked.getByText(/Revoked on/i)).toBeVisible();

    // ----------------------------------------------------------------------
    // Invitee navigates to a protected route. Middleware re-reads
    // memberships, sees the revoked filter exclude the only row,
    // routes to /no-access.
    // ----------------------------------------------------------------------
    await invitee.goto('/');
    await invitee.waitForURL('**/no-access');
    await expect(invitee.getByRole('heading', { name: 'No access', exact: true })).toBeVisible();
    await expect(invitee.getByText(inviteeEmail)).toBeVisible();

    await adminCtx.close();
    await inviteeCtx.close();
  });
});
