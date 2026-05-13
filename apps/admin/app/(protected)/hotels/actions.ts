'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withServerActionInstrumentation } from '@sentry/nextjs';
import { createServerClient } from '@strictons/db/server';
import { createServiceRoleClient } from '@strictons/db/client';
import { writeAuditLog } from '@strictons/db/audit';
import { getMembershipSet } from '@strictons/db/roles';
import type { Database } from '@strictons/db/types';
import {
  HotelCreateInputSchema,
  HotelUpdateInputSchema,
  type HotelApprovalState,
} from '@strictons/types/hotels';
import type { HotelFormState, HotelFormValues } from './types';

/**
 * Environment-variable convention.
 *
 * Env vars are read inside createServiceRoleClient() / createServerClient(),
 * never at this module's top level.
 *
 * 'use server' rule: every export must be an async function. Non-function
 * exports live in ./types.ts.
 *
 * Sentry instrumentation: every action wraps its body in
 * withServerActionInstrumentation per Phase 4 commit 2's locked pattern.
 * `formData` is NOT passed to the wrapper — form fields include
 * contact_email (PII) and we don't want it as a Sentry event extra.
 *
 * Revalidation: every successful mutation calls revalidatePath('/hotels')
 * (and the specific edit-page path on update). Per Phase 4 commit 8's
 * locked decision: revalidatePath is the mutation+revalidate primitive
 * for Server Actions, and it closes the click-vs-reload race by gating
 * the action's response on the re-render.
 *
 * Writes via service-role client per Phase 2's locked decision: no
 * `FOR ALL to authenticated using is_strictons_staff()` policy exists
 * on `hotels`, so admin-side mutations bypass RLS via service-role.
 * The auth check is defence-in-depth (verify caller is Strictons staff
 * before calling service-role). The middleware already gates the
 * (protected) route group; this second check costs one extra Supabase
 * round-trip but guarantees no mis-routed action runs against an
 * unauthorised caller.
 */

// ----------------------------------------------------------------------------
// Compile-time exhaustiveness check
// ----------------------------------------------------------------------------
//
// HOTEL_APPROVAL_STATES in @strictons/types/hotels is the runtime-readable
// mirror of the DB enum. If migration 1's enum drifts (added or renamed
// value), this assertion fails until the literal array is updated.
//
// Direction one: every value in the literal array is a valid DB enum.
// Already enforced by the `as const satisfies …` in the types file.
//
// Direction two: every DB enum value appears in the literal array.
// Enforced here, in admin's actions.ts (where @strictons/db is already
// a dep — adding it to @strictons/types just for this check would widen
// the types package's dep graph for marketing / mystay).
type DbHotelApprovalState = Database['public']['Enums']['hotel_approval_state'];
type _MissingFromLiteralArray = Exclude<DbHotelApprovalState, HotelApprovalState>;
const _hotelApprovalStateExhaustivenessCheck: _MissingFromLiteralArray extends never
  ? true
  : ['ERROR: HOTEL_APPROVAL_STATES is missing values from the DB enum', _MissingFromLiteralArray] =
  true;
void _hotelApprovalStateExhaustivenessCheck;

// ----------------------------------------------------------------------------
// Auth check
// ----------------------------------------------------------------------------

async function requireStaff(): Promise<
  { kind: 'ok'; userId: string; email: string } | { kind: 'error'; error: string }
> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { kind: 'error', error: 'Not signed in.' };
  }
  const memberships = await getMembershipSet(supabase, user.id);
  if (!memberships.isStrictonsStaff) {
    return { kind: 'error', error: 'You do not have Strictons staff access.' };
  }
  return { kind: 'ok', userId: user.id, email: memberships.email };
}

// ----------------------------------------------------------------------------
// FormData parsing helpers
// ----------------------------------------------------------------------------

/**
 * Empty-string → null normalisation for custom_domain. HTML form inputs
 * submit '' when blanked; the zod schema treats '' as a string that
 * fails min(1). We want '' to mean "clear the field" → null.
 */
function normaliseCustomDomain(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readCreateForm(formData: FormData): HotelFormValues {
  return {
    name: (formData.get('name') ?? '').toString(),
    slug: (formData.get('slug') ?? '').toString(),
    contact_email: (formData.get('contact_email') ?? '').toString(),
    approval_state: (formData.get('approval_state') ?? '').toString(),
    custom_domain: normaliseCustomDomain((formData.get('custom_domain') ?? '').toString()),
  };
}

function readUpdateForm(formData: FormData): HotelFormValues & { id?: string } {
  return {
    id: (formData.get('id') ?? '').toString(),
    name: (formData.get('name') ?? '').toString(),
    contact_email: (formData.get('contact_email') ?? '').toString(),
    approval_state: (formData.get('approval_state') ?? '').toString(),
    custom_domain: normaliseCustomDomain((formData.get('custom_domain') ?? '').toString()),
    // slug intentionally NOT read — immutable per the DB trigger.
  };
}

/**
 * Map a Supabase / Postgrest error into per-field form errors when
 * possible. The schema-level uniques on hotels are:
 *   slug          (citext unique) → DB code 23505, constraint name
 *                                   includes "slug"
 *   custom_domain (citext unique) → DB code 23505, constraint name
 *                                   includes "custom_domain"
 * Postgrest exposes these as { code: '23505', message: '...', details:
 * 'Key (slug)=(beachcomber) already exists.' }. We don't pre-check
 * (racy); the DB error IS the check. Per Q5 of the approved plan.
 */
function mapDbErrorToFieldErrors(
  error: { code?: string; message?: string; details?: string } | null,
): { fieldErrors?: Record<string, string>; topLevel?: string } | null {
  if (!error) return null;
  const haystack = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  if (error.code === '23505') {
    if (haystack.includes('slug')) {
      return { fieldErrors: { slug: 'Slug is already taken. Choose another.' } };
    }
    if (haystack.includes('custom_domain')) {
      return {
        fieldErrors: {
          custom_domain:
            'Another hotel is already attached to this custom domain. Detach it there first.',
        },
      };
    }
  }
  return { topLevel: error.message ?? 'Could not save. Please try again.' };
}

// ----------------------------------------------------------------------------
// createHotel
// ----------------------------------------------------------------------------

export async function createHotel(
  _prev: HotelFormState,
  formData: FormData,
): Promise<HotelFormState> {
  return withServerActionInstrumentation('createHotel', async (): Promise<HotelFormState> => {
    const auth = await requireStaff();
    if (auth.kind === 'error') {
      return { error: auth.error };
    }
    const { userId } = auth;

    const raw = readCreateForm(formData);
    const parsed = HotelCreateInputSchema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !(key in fieldErrors)) {
          fieldErrors[key] = issue.message;
        }
      }
      return {
        error: 'Please fix the errors below.',
        fieldErrors,
        values: raw,
      };
    }
    const input = parsed.data;

    const service = createServiceRoleClient();
    const { data, error } = await service
      .from('hotels')
      .insert({
        name: input.name,
        slug: input.slug,
        contact_email: input.contact_email,
        approval_state: input.approval_state,
        custom_domain: input.custom_domain,
      })
      .select('id')
      .single();

    if (error || !data) {
      const mapped = mapDbErrorToFieldErrors(error);
      await writeAuditLog({
        actor_user_id: userId,
        actor_role: 'strictons_staff',
        action: 'hotel_create_failed',
        entity_type: 'hotels',
        entity_id: crypto.randomUUID(),
        after: { input, reason: error?.message ?? 'unknown' },
      });
      return {
        error: mapped?.topLevel ?? 'Could not create the hotel. Please try again.',
        fieldErrors: mapped?.fieldErrors,
        values: raw,
      };
    }

    await writeAuditLog({
      actor_user_id: userId,
      actor_role: 'strictons_staff',
      action: 'hotel_created',
      entity_type: 'hotels',
      entity_id: data.id,
      entity_hotel_id: data.id,
      after: { ...input },
    });

    revalidatePath('/hotels');
    redirect(`/hotels/${data.id}`);
  });
}

// ----------------------------------------------------------------------------
// updateHotel
// ----------------------------------------------------------------------------

export async function updateHotel(
  _prev: HotelFormState,
  formData: FormData,
): Promise<HotelFormState> {
  return withServerActionInstrumentation('updateHotel', async (): Promise<HotelFormState> => {
    const auth = await requireStaff();
    if (auth.kind === 'error') {
      return { error: auth.error };
    }
    const { userId } = auth;

    const raw = readUpdateForm(formData);
    const parsed = HotelUpdateInputSchema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !(key in fieldErrors)) {
          fieldErrors[key] = issue.message;
        }
      }
      return {
        error: 'Please fix the errors below.',
        fieldErrors,
        values: raw,
      };
    }
    const { id, ...patch } = parsed.data;

    // Read the pre-update row so the audit_log `before` snapshot is
    // accurate. Service-role: bypass RLS (admin always sees all rows).
    const service = createServiceRoleClient();
    const { data: before, error: beforeError } = await service
      .from('hotels')
      .select('name, slug, contact_email, approval_state, custom_domain')
      .eq('id', id)
      .single();
    if (beforeError || !before) {
      return {
        error: 'Hotel not found.',
        values: raw,
      };
    }

    const { error } = await service.from('hotels').update(patch).eq('id', id);

    if (error) {
      const mapped = mapDbErrorToFieldErrors(error);
      await writeAuditLog({
        actor_user_id: userId,
        actor_role: 'strictons_staff',
        action: 'hotel_update_failed',
        entity_type: 'hotels',
        entity_id: id,
        entity_hotel_id: id,
        before,
        after: { patch, reason: error.message },
      });
      return {
        error: mapped?.topLevel ?? 'Could not save changes. Please try again.',
        fieldErrors: mapped?.fieldErrors,
        values: raw,
      };
    }

    await writeAuditLog({
      actor_user_id: userId,
      actor_role: 'strictons_staff',
      action: 'hotel_updated',
      entity_type: 'hotels',
      entity_id: id,
      entity_hotel_id: id,
      before,
      after: patch,
    });

    revalidatePath('/hotels');
    revalidatePath(`/hotels/${id}`);
    return { ok: true };
  });
}

// ----------------------------------------------------------------------------
// HOTEL_APPROVAL_STATES re-export — keeps the form import surface minimal
// (HotelForm.tsx needs the list for the <select>; importing from
// @strictons/types from a Client Component would force the package's
// runtime bundle to ship even if other consumers tree-shook it).
// ----------------------------------------------------------------------------
//
// Actually — 'use server' files may only export async functions.
// Re-exports of a constant array would be a non-function export and
// trigger the runtime "A 'use server' file can only export async
// functions" error. HotelForm.tsx imports HOTEL_APPROVAL_STATES
// directly from @strictons/types/hotels. This comment exists so a
// future maintainer doesn't try to re-export here.
