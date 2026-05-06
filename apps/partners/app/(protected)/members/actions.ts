'use server';

import { createServerClient } from '@strictons/db/server';
import { getMembershipSet } from '@strictons/db/roles';
import {
  InviteBusinessMemberInputSchema,
  InviteHotelMemberInputSchema,
  RevokeMemberInputSchema,
} from '@strictons/types/invites';
import { writeAuditLog } from '@/lib/audit';

/**
 * Environment-variable convention.
 *
 * Env vars are read inside the Supabase client factories (server.ts /
 * client.ts), never at this module's top level.
 */

export type ActionState = {
  ok?: true;
  error?: string;
};

const INITIAL_STATE: ActionState = {};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Resolve the authenticated user, their memberships, and assert they
 * are an admin of the requested scope. Returns the supabase client so
 * the caller can reuse it for the mutation.
 *
 * Defence in depth: explicit admin check here AND RLS gating at the
 * database. Migration 14's column GRANTs further restrict which
 * columns an authenticated INSERT/UPDATE may touch, so even a misrouted
 * action cannot leak across scopes or escalate fields outside the
 * invite/revoke surface.
 */
async function requireAdmin(
  scope: 'hotel' | 'business',
  scopeId: string,
): Promise<
  | {
      kind: 'ok';
      supabase: Awaited<ReturnType<typeof createServerClient>>;
      userId: string;
      email: string;
    }
  | { kind: 'error'; error: string }
> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { kind: 'error', error: 'Not signed in.' };
  }

  const memberships = await getMembershipSet(supabase, user.id);
  const isAdmin = memberships.roles.some((role) => {
    if (scope === 'hotel') {
      return role.kind === 'hotel_admin' && role.hotelId === scopeId;
    }
    return role.kind === 'business_admin' && role.businessId === scopeId;
  });
  if (!isAdmin) {
    return { kind: 'error', error: 'You do not admin this scope.' };
  }

  return { kind: 'ok', supabase, userId: user.id, email: memberships.email };
}

// ----------------------------------------------------------------------------
// Invite
// ----------------------------------------------------------------------------

export async function inviteHotelMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = InviteHotelMemberInputSchema.safeParse({
    email: (formData.get('email') ?? '').toString(),
    hotelId: (formData.get('hotelId') ?? '').toString(),
  });
  if (!parsed.success) {
    return { error: 'Please enter a valid email address.' };
  }
  const { email, hotelId } = parsed.data;

  const auth = await requireAdmin('hotel', hotelId);
  if (auth.kind === 'error') {
    return { error: auth.error };
  }

  const { supabase, userId } = auth;

  // INSERT via the SSR (RLS-enforced) client. Migration 14's column
  // GRANT restricts the writable columns to (hotel_id, invited_email,
  // invited_by); the row's id, is_admin, accepted_at, revoked_at,
  // revoked_by, created_at all default or are populated by triggers.
  const { data, error } = await supabase
    .from('hotel_users')
    .insert({ hotel_id: hotelId, invited_email: email, invited_by: userId })
    .select('id')
    .single();

  if (error || !data) {
    await writeAuditLog({
      actor_user_id: userId,
      actor_role: 'hotel_admin',
      action: 'invite_failed',
      entity_type: 'hotel_users',
      entity_id: crypto.randomUUID(),
      entity_hotel_id: hotelId,
      after: { invited_email: email, reason: error?.message ?? 'unknown' },
    });
    return { error: 'Could not send the invite. Please try again.' };
  }

  await writeAuditLog({
    actor_user_id: userId,
    actor_role: 'hotel_admin',
    action: 'invite_issued',
    entity_type: 'hotel_users',
    entity_id: data.id,
    entity_hotel_id: hotelId,
    after: { invited_email: email },
  });

  return { ok: true };
}

export async function inviteBusinessMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = InviteBusinessMemberInputSchema.safeParse({
    email: (formData.get('email') ?? '').toString(),
    businessId: (formData.get('businessId') ?? '').toString(),
  });
  if (!parsed.success) {
    return { error: 'Please enter a valid email address.' };
  }
  const { email, businessId } = parsed.data;

  const auth = await requireAdmin('business', businessId);
  if (auth.kind === 'error') {
    return { error: auth.error };
  }

  const { supabase, userId } = auth;

  const { data, error } = await supabase
    .from('business_users')
    .insert({ business_id: businessId, invited_email: email, invited_by: userId })
    .select('id')
    .single();

  if (error || !data) {
    await writeAuditLog({
      actor_user_id: userId,
      actor_role: 'business_admin',
      action: 'invite_failed',
      entity_type: 'business_users',
      entity_id: crypto.randomUUID(),
      entity_business_id: businessId,
      after: { invited_email: email, reason: error?.message ?? 'unknown' },
    });
    return { error: 'Could not send the invite. Please try again.' };
  }

  await writeAuditLog({
    actor_user_id: userId,
    actor_role: 'business_admin',
    action: 'invite_issued',
    entity_type: 'business_users',
    entity_id: data.id,
    entity_business_id: businessId,
    after: { invited_email: email },
  });

  return { ok: true };
}

// ----------------------------------------------------------------------------
// Revoke
// ----------------------------------------------------------------------------

export async function revokeMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = RevokeMemberInputSchema.safeParse({
    membershipId: (formData.get('membershipId') ?? '').toString(),
    scope: (formData.get('scope') ?? '').toString(),
  });
  if (!parsed.success) {
    return { error: 'Invalid revoke payload.' };
  }
  const { membershipId, scope } = parsed.data;

  // We need the scope_id (hotel_id or business_id) to verify the caller
  // is admin of the membership's scope. Look up the row first via the
  // SSR client; RLS lets admins read all rows in their scope, so a
  // missing row → caller doesn't admin (or doesn't share) the scope.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Not signed in.' };
  }

  // Branch by scope so the .select() string is a literal — Supabase JS's
  // typed query builder can't narrow a templated column list at compile
  // time and falls back to a SelectQueryError union otherwise.
  let scopeId: string;
  let rowUserId: string | null;
  if (scope === 'hotel') {
    const { data: row, error: lookupError } = await supabase
      .from('hotel_users')
      .select('id, hotel_id, user_id')
      .eq('id', membershipId)
      .maybeSingle();
    if (lookupError || !row) {
      return { error: 'Membership not found.' };
    }
    scopeId = row.hotel_id;
    rowUserId = row.user_id;
  } else {
    const { data: row, error: lookupError } = await supabase
      .from('business_users')
      .select('id, business_id, user_id')
      .eq('id', membershipId)
      .maybeSingle();
    if (lookupError || !row) {
      return { error: 'Membership not found.' };
    }
    scopeId = row.business_id;
    rowUserId = row.user_id;
  }

  const auth = await requireAdmin(scope, scopeId);
  if (auth.kind === 'error') {
    return { error: auth.error };
  }
  const { userId } = auth;

  // Self-revoke guard. The plan calls for this gate at the UI level;
  // belt-and-braces here too. The admin-app in Phase 4 may relax this.
  if (rowUserId === userId) {
    return { error: 'You cannot revoke your own membership.' };
  }

  const table = scope === 'hotel' ? 'hotel_users' : 'business_users';

  // UPDATE via SSR client. Column GRANT restricts to (revoked_at,
  // revoked_by); admin_revoke policy gates the row.
  const revokedAt = new Date().toISOString();
  const updateResult =
    scope === 'hotel'
      ? await supabase
          .from('hotel_users')
          .update({ revoked_at: revokedAt, revoked_by: userId })
          .eq('id', membershipId)
      : await supabase
          .from('business_users')
          .update({ revoked_at: revokedAt, revoked_by: userId })
          .eq('id', membershipId);

  if (updateResult.error) {
    await writeAuditLog({
      actor_user_id: userId,
      actor_role: scope === 'hotel' ? 'hotel_admin' : 'business_admin',
      action: 'invite_revoke_failed',
      entity_type: table,
      entity_id: membershipId,
      ...(scope === 'hotel' ? { entity_hotel_id: scopeId } : { entity_business_id: scopeId }),
      after: { reason: updateResult.error.message },
    });
    return { error: 'Could not revoke the membership. Please try again.' };
  }

  await writeAuditLog({
    actor_user_id: userId,
    actor_role: scope === 'hotel' ? 'hotel_admin' : 'business_admin',
    action: 'invite_revoked',
    entity_type: table,
    entity_id: membershipId,
    ...(scope === 'hotel' ? { entity_hotel_id: scopeId } : { entity_business_id: scopeId }),
    after: { revoked_at: revokedAt, revoked_by: userId },
  });

  return { ok: true };
}

export { INITIAL_STATE as MEMBERS_INITIAL_STATE };
