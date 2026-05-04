/**
 * Local-dev seed for auth-linked fixtures.
 *
 * Idempotent. Safe to run multiple times: existing rows are skipped.
 *
 *   pnpm --filter @strictons/db db:seed
 *
 * Required env:
 *   SUPABASE_URL                 default: http://127.0.0.1:54321 (local CLI)
 *   SUPABASE_SECRET_KEY    from `supabase start` output
 *
 * This script only runs against local dev. The dev and prod Supabase
 * projects must never be seeded with this data.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SECRET_KEY) {
  console.error('SUPABASE_SECRET_KEY is required. Run `supabase status` to copy the local key.');
  process.exit(1);
}

if (!SUPABASE_URL.includes('127.0.0.1') && !SUPABASE_URL.includes('localhost')) {
  console.error(`Refusing to seed: SUPABASE_URL=${SUPABASE_URL} is not local.`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type SeedUser = { email: string; displayName: string };

async function ensureAuthUser({ email, displayName }: SeedUser): Promise<string> {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) throw listErr;
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    return existing.id;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error) throw error;
  if (!data.user) throw new Error(`auth.admin.createUser returned no user for ${email}`);
  return data.user.id;
}

async function ensureStaff(userId: string): Promise<void> {
  const { error } = await supabase
    .from('strictons_staff')
    .upsert({ user_id: userId }, { onConflict: 'user_id' });
  if (error) throw error;
}

async function ensureHotel(slug: string, name: string, contactEmail: string): Promise<string> {
  const { data: existing } = await supabase
    .from('hotels')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from('hotels')
    .insert({ slug, name, contact_email: contactEmail })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function ensureGuide(
  hotelId: string,
  termStartsOn: string,
  termEndsOn: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from('guides')
    .select('id')
    .eq('hotel_id', hotelId)
    .eq('term_starts_on', termStartsOn)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from('guides')
    .insert({ hotel_id: hotelId, term_starts_on: termStartsOn, term_ends_on: termEndsOn })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function ensureBusiness(legalName: string, displayName: string): Promise<string> {
  const { data: existing } = await supabase
    .from('businesses')
    .select('id')
    .eq('legal_name', legalName)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from('businesses')
    .insert({ legal_name: legalName, display_name: displayName })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function main() {
  console.log(`Seeding ${SUPABASE_URL} ...`);

  // Two Strictons staff users.
  const staffAId = await ensureAuthUser({
    email: 'alex@strictons.test',
    displayName: 'Alex Staff',
  });
  const staffBId = await ensureAuthUser({ email: 'sam@strictons.test', displayName: 'Sam Staff' });
  await ensureStaff(staffAId);
  await ensureStaff(staffBId);

  // Two hotels with one current guide each.
  const beachcomberId = await ensureHotel(
    'beachcomber',
    'Beachcomber Hotel',
    'reception@beachcomber.test',
  );
  const cityId = await ensureHotel(
    'city-collins',
    'City Collins Hotel',
    'concierge@citycollins.test',
  );

  await ensureGuide(beachcomberId, '2026-01-01', '2026-12-31');
  await ensureGuide(cityId, '2026-04-01', '2027-03-31');

  // Two businesses (one per hotel guide, simplified for the seed).
  await ensureBusiness('Sunrise Boats Pty Ltd', 'Sunrise Boats');
  await ensureBusiness('Collins Coffee Co', 'Collins Coffee');

  // Hotel admin invitee — staff in the partners app needs a row to sign in
  // against. The user is invited but unaccepted (user_id null) until a real
  // magic-link sign-in happens in Phase 3.
  await supabase.from('hotel_users').upsert(
    [
      { hotel_id: beachcomberId, invited_email: 'reception@beachcomber.test' },
      { hotel_id: cityId, invited_email: 'concierge@citycollins.test' },
    ],
    { onConflict: 'hotel_id,invited_email' },
  );

  console.log('Seed complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
