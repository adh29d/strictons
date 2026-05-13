import { createServiceRoleClient } from '@strictons/db/client';
import { ResendPortalAccessLinkButton } from './resend-portal-access-link-button';

/**
 * Server Component — never imported from a 'use client' module.
 * Reads hotel_users for the given hotel via service-role (Strictons
 * staff bypasses RLS on this surface per the Phase 2 locked
 * decision).
 *
 * Re-renders on revalidatePath('/hotels/[id]') from the sibling
 * Server Actions, so a successful inviteHotelAdmin makes the new row
 * appear here without a manual reload. The page itself is already
 * force-dynamic per Phase 4 — this component inherits that.
 */
type Props = {
  hotelId: string;
};

type HotelAdminRow = {
  id: string;
  invited_email: string;
  is_admin: boolean;
  user_id: string | null;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

type RowStatus = 'pending' | 'accepted' | 'revoked';

function statusOf(row: HotelAdminRow): RowStatus {
  if (row.revoked_at) return 'revoked';
  if (row.accepted_at) return 'accepted';
  return 'pending';
}

function formatDate(iso: string): string {
  // YYYY-MM-DD; matches the partners-side members page convention.
  return iso.slice(0, 10);
}

function statusLabel(row: HotelAdminRow): string {
  const status = statusOf(row);
  if (status === 'revoked') {
    return `Revoked on ${formatDate(row.revoked_at as string)}`;
  }
  if (status === 'accepted') {
    return `Accepted on ${formatDate(row.accepted_at as string)}`;
  }
  return `Pending — invited ${formatDate(row.created_at)}`;
}

export async function HotelAdminsList({ hotelId }: Props): Promise<React.ReactElement> {
  const service = createServiceRoleClient();
  const { data, error } = await service
    .from('hotel_users')
    .select('id, invited_email, is_admin, user_id, created_at, accepted_at, revoked_at')
    .eq('hotel_id', hotelId)
    .order('created_at', { ascending: true });

  if (error) {
    return (
      <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        Could not load hotel admins: {error.message}
      </p>
    );
  }

  const rows = (data ?? []) as HotelAdminRow[];

  if (rows.length === 0) {
    return (
      <p className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
        No hotel admins yet. Use the form above to invite the first hotel admin.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
      {rows.map((row) => {
        const status = statusOf(row);
        return (
          <li
            key={row.id}
            className={`flex items-start justify-between gap-4 px-4 py-3 ${
              status === 'revoked' ? 'opacity-60' : ''
            }`}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-neutral-900">{row.invited_email}</div>
              <div className="mt-1 text-xs text-neutral-600">
                {row.is_admin ? 'Admin · ' : ''}
                {statusLabel(row)}
              </div>
            </div>
            <ResendPortalAccessLinkButton
              hotelId={hotelId}
              hotelUserId={row.id}
              disabled={status === 'revoked'}
            />
          </li>
        );
      })}
    </ul>
  );
}
