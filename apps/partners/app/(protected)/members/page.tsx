import { redirect } from 'next/navigation';
import { createServerClient } from '@strictons/db/server';
import { getMembershipSet } from '@strictons/db/roles';
import type { PartnerRole } from '@strictons/db/auth-types';
import { InviteForm } from './InviteForm';
import { RevokeButton } from './RevokeButton';

/**
 * /members?hotel=<id> | ?business=<id>
 *
 * Admin-only listing + invite + revoke surface for a single scope
 * (one hotel OR one business). Scope switching is by URL param per
 * Q3 — when admins land here without a scope param, we route them
 * to the first scope they admin.
 *
 * Authorization: middleware (commit 9) gates the (protected) route
 * group on auth + at-least-one membership. This page runs an
 * additional admin check via getMembershipSet because being a
 * non-admin member doesn't grant access here. Misrouted requests
 * (e.g. /members?hotel=<id-of-other-hotel>) silently redirect to /
 * — don't leak the existence of scopes the caller doesn't admin.
 *
 * Marked dynamic for the same reason as other (protected) pages: the
 * page reads request cookies via createServerClient → next/headers
 * cookies(). Without this Next would attempt static prerender at
 * build time and trip the C2 env-var-fail-loud check.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ hotel?: string; business?: string }>;

type ScopeContext =
  | { scope: 'hotel'; scopeId: string; scopeName: string }
  | { scope: 'business'; scopeId: string; scopeName: string };

export default async function MembersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<React.ReactElement> {
  const params = await searchParams;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in');
  }
  const memberships = await getMembershipSet(supabase, user.id);

  const adminScopes = memberships.roles.filter(
    (r) => r.kind === 'hotel_admin' || r.kind === 'business_admin',
  );
  if (adminScopes.length === 0) {
    redirect('/');
  }

  // No scope param — pick the user's first admin scope and redirect
  // to a stable URL so the address bar reflects the active scope.
  if (!params.hotel && !params.business) {
    const first = adminScopes[0];
    if (first?.kind === 'hotel_admin') {
      redirect(`/members?hotel=${first.hotelId}`);
    } else if (first?.kind === 'business_admin') {
      redirect(`/members?business=${first.businessId}`);
    }
  }

  // Resolve the requested scope and verify admin authority.
  const ctx = resolveScope(params, memberships.roles);
  if (!ctx) {
    redirect('/');
  }

  // Read members of the active scope. RLS lets any member of the scope
  // SELECT all hotel_users / business_users rows of that scope, so an
  // admin reads everyone.
  const rows = await fetchScopeMembers(supabase, ctx);
  const sorted = sortMembers(rows);
  const userResolver = buildUserEmailResolver(rows, memberships);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Members</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {ctx.scope === 'hotel' ? 'Hotel' : 'Business'}: <strong>{ctx.scopeName}</strong>
        </p>
        {adminScopes.length > 1 ? (
          <p className="mt-2 text-xs text-neutral-500">
            You admin {adminScopes.length} scopes. Switch via URL: <code>?hotel=…</code> or{' '}
            <code>?business=…</code>.
          </p>
        ) : null}
      </header>

      <section className="mb-8">
        <h2 className="mb-2 text-base font-semibold">Invite a member</h2>
        <InviteForm scope={ctx.scope} scopeId={ctx.scopeId} />
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">All members</h2>
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
          {sorted.map((row) => (
            <li
              key={row.id}
              className={`flex items-center justify-between gap-4 px-4 py-3 text-sm ${
                row.revoked_at ? 'opacity-60' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="font-medium">{row.invited_email}</div>
                <div className="mt-1 text-xs text-neutral-600">
                  {describeStatus(row, userResolver)}
                </div>
              </div>
              <div>
                <RevokeButton
                  membershipId={row.id}
                  scope={ctx.scope}
                  invitedEmail={row.invited_email}
                  scopeName={ctx.scopeName}
                  disabled={row.revoked_at !== null || row.user_id === user.id}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

// ---- Helpers --------------------------------------------------------------

type MemberRow = {
  id: string;
  invited_email: string;
  is_admin: boolean;
  user_id: string | null;
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
};

function resolveScope(
  params: { hotel?: string; business?: string },
  roles: PartnerRole[],
): ScopeContext | null {
  if (params.hotel) {
    const role = roles.find((r) => r.kind === 'hotel_admin' && r.hotelId === params.hotel);
    if (!role || role.kind !== 'hotel_admin') return null;
    return { scope: 'hotel', scopeId: role.hotelId, scopeName: role.hotelName };
  }
  if (params.business) {
    const role = roles.find((r) => r.kind === 'business_admin' && r.businessId === params.business);
    if (!role || role.kind !== 'business_admin') return null;
    return {
      scope: 'business',
      scopeId: role.businessId,
      scopeName: role.businessName,
    };
  }
  return null;
}

async function fetchScopeMembers(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  ctx: ScopeContext,
): Promise<MemberRow[]> {
  if (ctx.scope === 'hotel') {
    const { data } = await supabase
      .from('hotel_users')
      .select(
        'id, invited_email, is_admin, user_id, invited_by, created_at, accepted_at, revoked_at, revoked_by',
      )
      .eq('hotel_id', ctx.scopeId);
    return (data ?? []).map((r) => ({
      id: r.id,
      invited_email: r.invited_email,
      is_admin: r.is_admin,
      user_id: r.user_id,
      invited_by: r.invited_by,
      invited_at: r.created_at,
      accepted_at: r.accepted_at,
      revoked_at: r.revoked_at,
      revoked_by: r.revoked_by,
    }));
  }
  const { data } = await supabase
    .from('business_users')
    .select(
      'id, invited_email, is_admin, user_id, invited_by, created_at, accepted_at, revoked_at, revoked_by',
    )
    .eq('business_id', ctx.scopeId);
  return (data ?? []).map((r) => ({
    id: r.id,
    invited_email: r.invited_email,
    is_admin: r.is_admin,
    user_id: r.user_id,
    invited_by: r.invited_by,
    invited_at: r.created_at,
    accepted_at: r.accepted_at,
    revoked_at: r.revoked_at,
    revoked_by: r.revoked_by,
  }));
}

function memberStage(row: MemberRow): 0 | 1 | 2 {
  if (row.revoked_at) return 2;
  if (row.accepted_at) return 1;
  return 0;
}

function sortMembers(rows: MemberRow[]): MemberRow[] {
  return [...rows].sort((a, b) => {
    const stageDiff = memberStage(a) - memberStage(b);
    if (stageDiff !== 0) return stageDiff;
    return b.invited_at.localeCompare(a.invited_at);
  });
}

/**
 * Build an in-memory map of user_id → invited_email so we can resolve
 * invited_by / revoked_by uuids without a JOIN to public.users (which
 * RLS would deny — admins can't read public.users rows other than
 * their own under `users_select_own`).
 *
 * Only resolves uuids for users who are also members of the same
 * scope. Outside-scope actors (e.g. a Strictons admin who issued the
 * invite via service-role) fall through to "—".
 */
function buildUserEmailResolver(
  rows: MemberRow[],
  memberships: Awaited<ReturnType<typeof getMembershipSet>>,
): (userId: string | null) => string | null {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.user_id) map.set(r.user_id, r.invited_email);
  }
  // The current user (the admin) has their own email in memberships
  // — if for any reason they don't appear in the rows (corner case),
  // include them so "you revoked X" displays cleanly.
  map.set(memberships.userId, memberships.email);
  return (uid) => (uid ? (map.get(uid) ?? null) : null);
}

function describeStatus(
  row: MemberRow,
  resolveEmail: (userId: string | null) => string | null,
): string {
  if (row.revoked_at) {
    const by = resolveEmail(row.revoked_by);
    const date = formatDate(row.revoked_at);
    return by ? `Revoked on ${date} by ${by}` : `Revoked on ${date}`;
  }
  if (row.accepted_at) {
    const role = row.is_admin ? 'Admin' : 'Member';
    return `${role} · accepted ${formatDate(row.accepted_at)}`;
  }
  const by = resolveEmail(row.invited_by);
  const date = formatDate(row.invited_at);
  return by ? `Pending — invited ${date} by ${by}` : `Pending — invited ${date}`;
}

function formatDate(iso: string): string {
  // YYYY-MM-DD; the locale-aware version is a Phase 4 polish.
  return iso.slice(0, 10);
}
