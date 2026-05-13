import { test, expect } from '@playwright/test';
import { createServiceRoleClient } from '@strictons/db/client';
import { signInWithMagicLink } from './helpers/magic-link';

/**
 * Phase 5 staff-side hotel-admin invitation E2E.
 *
 * Cross-app spec: Strictons staff signs in to the admin app, invites
 * a hotel admin from /hotels/<id>, the magic link lands in the
 * memory inbox; the spec then extracts the link and navigates the
 * invitee directly to the partners-app /auth/confirm (the link's
 * NEXT_PUBLIC_PARTNERS_URL host), where the existing partners-side
 * reconciliation flips user_id IS NULL → user_id on the new
 * hotel_users row and the invitee lands at partners /.
 *
 * The cross-app navigation reads `E2E_PARTNERS_URL` (default
 * http://localhost:3002) — set in playwright.config.ts's webServer
 * env block and forwarded through the host environment. Partners is
 * NOT a second webServer entry; it runs as an independent process
 * (locally `pnpm dev`; in CI a background process started by
 * .github/workflows/e2e-admin.yml).
 *
 * Race resolution (Phase 4 lock):
 *   - The form's "Invitation sent." role="status" text is the
 *     deterministic post-action signal. The test waits on the text
 *     before any reload or downstream assertion. No
 *     page.waitForTimeout, no diagnostic DB reads sprinkled through
 *     to mask races.
 *
 * Fixture isolation:
 *   - Each run creates a fresh staff user, strictons_staff row,
 *     hotel, and invitee email (all suffixed with Date.now() +
 *     randomString). Cleanup in afterAll bans the staff + invitee
 *     auth users via banned_until=2099 rather than deleting (audit_
 *     log append-only + ON DELETE SET NULL FKs make every audited
 *     row effectively immutable; Phase 4 locked decision).
 */

const HOTEL_ADMINS_HEADING = 'Hotel admins';
const INVITE_HEADING = 'Invite a hotel admin';
const INVITE_SUCCESS_TEXT = 'Invitation sent.';
const INVITE_SUBJECT = "You're invited to the Strictons hotel portal";

const PARTNERS_URL = process.env.E2E_PARTNERS_URL ?? 'http://localhost:3002';

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

test.describe('admin invites hotel admin → cross-app reconcile', () => {
  let staffEmail: string;
  let staffUserId: string;
  let inviteeEmail: string;
  let hotelId: string;
  let hotelSlug: string;
  let hotelName: string;

  test.beforeAll(async () => {
    const ts = Date.now();
    const suffix = randomSuffix();
    staffEmail = `e2e-admin-staff-${ts}-${suffix}@example.test`;
    inviteeEmail = `e2e-admin-invitee-${ts}-${suffix}@example.test`;
    hotelSlug = `e2e-admin-${ts}-${suffix}`;
    hotelName = `E2E Admin Hotel ${ts}-${suffix}`;

    const service = createServiceRoleClient();

    // ---- Create the staff auth user --------------------------------------
    const { data: staffAuth, error: staffErr } = await service.auth.admin.createUser({
      email: staffEmail,
      email_confirm: true,
    });
    if (staffErr || !staffAuth.user) {
      throw staffErr ?? new Error('beforeAll: staff auth.admin.createUser returned no user');
    }
    staffUserId = staffAuth.user.id;

    // ---- Promote to Strictons staff --------------------------------------
    // The on_auth_user_created trigger inserted public.users; we add
    // the strictons_staff row so middleware's isStrictonsStaff path
    // permits the user onto the (protected) admin routes.
    const { error: staffPromoteErr } = await service.from('strictons_staff').insert({
      user_id: staffUserId,
    });
    if (staffPromoteErr) {
      throw staffPromoteErr;
    }

    // ---- Create a fresh hotel --------------------------------------------
    const { data: hotelRow, error: hotelErr } = await service
      .from('hotels')
      .insert({
        slug: hotelSlug,
        name: hotelName,
        contact_email: `contact-${ts}-${suffix}@example.test`,
      })
      .select('id')
      .single();
    if (hotelErr || !hotelRow) {
      throw hotelErr ?? new Error('beforeAll: hotel insert returned no id');
    }
    hotelId = hotelRow.id;
  });

  test.afterAll(async () => {
    // Phase 4 deactivate-don't-delete pattern. audit_log is append-
    // only by trigger; FKs into public.users from audited tables are
    // ON DELETE SET NULL; both block hard DELETE on any user with
    // audit history. Ban via banned_until=2099 instead.
    const service = createServiceRoleClient();

    // Ban the staff user.
    if (staffUserId) {
      await service.auth.admin.updateUserById(staffUserId, {
        ban_duration: '876600h', // ~100 years; equivalent to banned_until=2099
      });
    }

    // Ban the invitee user (created during the magic-link consume —
    // generateLink with type 'magiclink' provisions auth.users if
    // missing). Lookup by email since we don't capture the id during
    // the test body.
    if (inviteeEmail) {
      const { data: lookup } = await service.auth.admin.listUsers();
      const invitee = lookup?.users?.find((u) => u.email === inviteeEmail);
      if (invitee) {
        await service.auth.admin.updateUserById(invitee.id, {
          ban_duration: '876600h',
        });
      }
    }
    // Hotel, hotel_users row, strictons_staff row remain — audit_log
    // append-only blocks hard delete on every audited row. Future
    // runs use fresh timestamps + suffixes so no collision.
  });

  test('staff invite → memory inbox → cross-app consume → reconcile + audit', async ({
    browser,
    request,
  }) => {
    // ----------------------------------------------------------------------
    // Staff context: sign in, navigate to the hotel edit page
    // ----------------------------------------------------------------------
    const staffCtx = await browser.newContext();
    const staff = await staffCtx.newPage();

    await signInWithMagicLink({ page: staff, request, email: staffEmail });

    // Middleware lands the staff user on / (admin landing). Navigate to
    // the hotel edit page.
    await staff.goto(`/hotels/${hotelId}`);

    // Confirm the page rendered with the new Phase 5 sections.
    await expect(staff.getByRole('heading', { name: hotelName })).toBeVisible();
    await expect(staff.getByRole('heading', { name: INVITE_HEADING })).toBeVisible();
    await expect(staff.getByRole('heading', { name: HOTEL_ADMINS_HEADING })).toBeVisible();

    // Empty state for the admins list (the hotel has no hotel_users
    // rows yet — this invite creates the first one).
    await expect(staff.getByText(/No hotel admins yet/i)).toBeVisible();

    // ----------------------------------------------------------------------
    // Submit the invite form
    // ----------------------------------------------------------------------
    // Scope the email fill to the "Invite a hotel admin" section so we
    // don't accidentally hit the HotelForm's contact_email input above.
    const inviteSection = staff.locator('section', { hasText: INVITE_HEADING });
    await inviteSection.getByLabel('Email').fill(inviteeEmail);
    await inviteSection.getByRole('button', { name: 'Send invitation' }).click();

    // The deterministic post-action signal: role="status" with the
    // success message. The action's revalidatePath fires before this
    // text becomes visible (useActionState updates state.message only
    // after the action's response has been processed, by which point
    // the DB INSERT has committed and the revalidated RSC is in
    // flight). Wait on the text — never reload before this.
    await expect(staff.getByRole('status').filter({ hasText: INVITE_SUCCESS_TEXT })).toBeVisible();

    // The new row should now appear in the Hotel admins list section
    // without a manual reload (revalidatePath('/hotels/[id]') triggers
    // the Server Component re-render).
    const adminsList = staff.locator('section', { hasText: HOTEL_ADMINS_HEADING });
    const inviteeRow = adminsList.getByRole('listitem').filter({ hasText: inviteeEmail });
    await expect(inviteeRow).toBeVisible();
    await expect(inviteeRow.getByText(/Pending/i)).toBeVisible();

    // ----------------------------------------------------------------------
    // Read the captured email from the admin process's memory inbox
    // ----------------------------------------------------------------------
    type InboxEntry = { to: string; subject: string; text: string; html: string };
    let entry: InboxEntry | null = null;
    for (let i = 0; i < 20 && !entry; i++) {
      const res = await request.get(`/api/test/last-email?to=${encodeURIComponent(inviteeEmail)}`);
      if (res.ok()) {
        const body = (await res.json()) as { entry: InboxEntry | null };
        if (body.entry) {
          entry = body.entry;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!entry) {
      throw new Error(`No hotel-admin invite email captured for ${inviteeEmail} after 4s polling`);
    }
    const captured: InboxEntry = entry;

    // Subject confirms it's the Surface 1 template, not the resend or
    // a Phase 3 magic-link template.
    expect(captured.subject).toBe(INVITE_SUBJECT);

    // Magic-link URL extraction. The link's host is PARTNERS_URL per
    // hotel-admin-magic-link.ts; assert that too.
    const linkMatch = captured.text.match(/https?:\/\/[^\s]+\/auth\/confirm\?[^\s]+/);
    if (!linkMatch) {
      throw new Error('No /auth/confirm URL in plain-text body');
    }
    const magicLink = linkMatch[0];
    expect(magicLink.startsWith(PARTNERS_URL)).toBe(true);

    // ----------------------------------------------------------------------
    // Cross-app: invitee context navigates to the magic-link URL.
    // The partners-side /auth/confirm reconciles the invite via the
    // existing service-role path (lifts user_id IS NULL → user_id;
    // sets accepted_at). Audit-logs invite_accepted.
    // ----------------------------------------------------------------------
    const inviteeCtx = await browser.newContext();
    const invitee = await inviteeCtx.newPage();

    await invitee.goto(magicLink);
    // /auth/confirm redirects on completion; wait for the destination
    // (the partners protected landing).
    await invitee.waitForURL((url) => !url.toString().includes('/auth/confirm'));

    // The invitee should land at partners / (protected landing) and
    // see "Strictons partners" heading + their email.
    await expect(invitee).not.toHaveURL(/\/no-access/);
    await expect(invitee.getByRole('heading', { name: 'Strictons partners' })).toBeVisible();
    await expect(invitee.getByText(inviteeEmail)).toBeVisible();

    // ----------------------------------------------------------------------
    // DB assertions: hotel_users reconciled + audit_log events
    // ----------------------------------------------------------------------
    const service = createServiceRoleClient();

    const { data: hotelUserRow } = await service
      .from('hotel_users')
      .select('id, hotel_id, invited_email, user_id, accepted_at, is_admin, invited_by, revoked_at')
      .eq('hotel_id', hotelId)
      .eq('invited_email', inviteeEmail)
      .maybeSingle();
    expect(hotelUserRow).not.toBeNull();
    if (!hotelUserRow) throw new Error('hotel_users row missing post-consume');
    expect(hotelUserRow.is_admin).toBe(true);
    expect(hotelUserRow.invited_by).toBe(staffUserId);
    expect(hotelUserRow.user_id).not.toBeNull();
    expect(hotelUserRow.accepted_at).not.toBeNull();
    expect(hotelUserRow.revoked_at).toBeNull();
    const hotelUserId = hotelUserRow.id;

    // ---- Admin-side audit row ----
    const { data: invitedAuditRows } = await service
      .from('audit_log')
      .select('action, actor_user_id, actor_role, entity_id, entity_hotel_id, after')
      .eq('action', 'hotel_admin_invite_issued')
      .eq('entity_hotel_id', hotelId);
    expect(invitedAuditRows ?? []).toHaveLength(1);
    const invitedAudit = (invitedAuditRows ?? [])[0];
    if (!invitedAudit) throw new Error('hotel_admin_invite_issued row missing');
    expect(invitedAudit.actor_user_id).toBe(staffUserId);
    expect(invitedAudit.actor_role).toBe('strictons_staff');
    expect(invitedAudit.entity_id).toBe(hotelUserId);

    // ---- Partners-side reconciliation audit row ----
    const { data: acceptedAuditRows } = await service
      .from('audit_log')
      .select('action, actor_user_id, entity_id, entity_hotel_id')
      .eq('action', 'invite_accepted')
      .eq('entity_hotel_id', hotelId);
    expect(acceptedAuditRows ?? []).toHaveLength(1);
    const acceptedAudit = (acceptedAuditRows ?? [])[0];
    if (!acceptedAudit) throw new Error('invite_accepted row missing');
    expect(acceptedAudit.entity_id).toBe(hotelUserId);
    // actor_user_id should be the invitee's auth user id (the
    // service-role reconcile passes data.user.id from verifyOtp).
    expect(acceptedAudit.actor_user_id).toBe(hotelUserRow.user_id);

    await staffCtx.close();
    await inviteeCtx.close();
  });
});
