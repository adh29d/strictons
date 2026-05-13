import { createServiceRoleClient } from './client';
import type { Database, Json } from './database.types';

/**
 * Service-role audit-log helper, lifted from apps/partners/lib/audit.ts
 * in Phase 4 commit 3 because the admin-app hotel CRUD actions in
 * commit 9 need an identical writer.
 *
 * audit_log INSERT is RLS-revoked from authenticated/anon — only the
 * service role can write. The append-only triggers on the table
 * block UPDATE / DELETE for every role including service_role, so
 * once a row lands it cannot be modified.
 *
 * This helper intentionally does NOT throw on write failure — audit
 * issues should never block user-facing flows. Errors are
 * console.error'd so they surface in Vercel function logs and reach
 * Sentry via the standard unhandled-error pathway (or, for caught
 * errors, via Server Action instrumentation).
 *
 * Env-var read convention: process.env access happens inside
 * createServiceRoleClient(), not here.
 */

type ActorRole = Database['public']['Enums']['actor_role'];

export type AuditLogEntry = {
  actor_user_id: string | null;
  actor_role: ActorRole;
  action: string;
  entity_type: string;
  entity_id: string;
  before?: Json | null;
  after?: Json | null;
  entity_hotel_id?: string | null;
  entity_business_id?: string | null;
};

export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const service = createServiceRoleClient();
    const { error } = await service.from('audit_log').insert({
      actor_user_id: entry.actor_user_id,
      actor_role: entry.actor_role,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      before: entry.before ?? null,
      after: entry.after ?? null,
      entity_hotel_id: entry.entity_hotel_id ?? null,
      entity_business_id: entry.entity_business_id ?? null,
    });
    if (error) {
      console.error('[audit] failed to write entry', {
        action: entry.action,
        entity_type: entry.entity_type,
        error: error.message,
      });
    }
  } catch (cause) {
    console.error('[audit] threw while writing entry', {
      action: entry.action,
      entity_type: entry.entity_type,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
