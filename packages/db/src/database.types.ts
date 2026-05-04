/**
 * Auto-generated Supabase database types.
 *
 * This file is OVERWRITTEN by `pnpm --filter @strictons/db gen:types`,
 * which runs `supabase gen types typescript --local` against the local
 * Supabase instance and dumps the result here.
 *
 * Regenerate after every migration. CI verifies no drift.
 *
 * The `Database = Record<string, never>` shape below is a Phase-2-bootstrap
 * placeholder. It will be replaced on first regeneration with the real
 * shape spanning every public.* table and enum. Apps consuming this type
 * before regeneration get a deliberately empty surface so the missing
 * regeneration is impossible to miss at compile time.
 */

export type Database = Record<string, never>;

export type Tables<_T extends string> = never;
export type Enums<_E extends string> = never;
