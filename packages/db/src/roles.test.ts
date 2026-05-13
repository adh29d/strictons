import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { getMembershipSet } from './roles';

// ---- Test mock builder -----------------------------------------------------
//
// `getMembershipSet` calls supabase.from() three times (users, hotel_users,
// business_users) in parallel via Promise.all. The mock dispatches per
// table name, returning a thenable query builder that records the chained
// filter calls so tests can assert filter shape.

type TableResponse = { data: unknown; error: unknown };

type ChainCall = { method: string; args: unknown[] };

interface QueryRecord {
  table: string;
  chain: ChainCall[];
}

function makeMock(responses: Record<string, TableResponse>) {
  const queries: QueryRecord[] = [];

  const supabase = {
    from: vi.fn((table: string) => {
      const record: QueryRecord = { table, chain: [] };
      queries.push(record);

      const response = responses[table] ?? {
        data: null,
        error: new Error(`unexpected query: ${table}`),
      };

      const chainable = (method: string) =>
        vi.fn((...args: unknown[]) => {
          record.chain.push({ method, args });
          return builder;
        });

      const builder = {
        select: chainable('select'),
        eq: chainable('eq'),
        is: chainable('is'),
        not: chainable('not'),
        maybeSingle: vi.fn(() => Promise.resolve(response)),
        single: vi.fn(() => Promise.resolve(response)),
        // Make the builder thenable so `await query` resolves directly
        // (used for the multi-row hotel_users / business_users queries).
        then: <T>(onFulfilled: (value: TableResponse) => T, onRejected?: (reason: unknown) => T) =>
          Promise.resolve(response).then(onFulfilled, onRejected),
      };
      return builder;
    }),
  };

  return {
    supabase: supabase as unknown as SupabaseClient<Database>,
    queries,
  };
}

const USER_ID = '11111111-1111-1111-1111-111111111111';
const USER_EMAIL = 'alice@example.test';
const HOTEL_ID = '22222222-2222-2222-2222-222222222222';
const HOTEL_ID_2 = '33333333-3333-3333-3333-333333333333';
const BUSINESS_ID = '44444444-4444-4444-4444-444444444444';

describe('getMembershipSet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aggregates two hotels + one business into a single roles array', async () => {
    const { supabase } = makeMock({
      users: { data: { email: USER_EMAIL }, error: null },
      hotel_users: {
        data: [
          {
            is_admin: true,
            hotel_id: HOTEL_ID,
            hotels: { slug: 'alpha', name: 'Alpha Hotel' },
          },
          {
            is_admin: false,
            hotel_id: HOTEL_ID_2,
            hotels: { slug: 'bravo', name: 'Bravo Hotel' },
          },
        ],
        error: null,
      },
      business_users: {
        data: [
          {
            is_admin: true,
            business_id: BUSINESS_ID,
            businesses: { display_name: 'Sunrise Joyflights' },
          },
        ],
        error: null,
      },
      strictons_staff: { data: null, error: null },
    });

    const result = await getMembershipSet(supabase, USER_ID);

    expect(result.userId).toBe(USER_ID);
    expect(result.email).toBe(USER_EMAIL);
    expect(result.roles).toHaveLength(3);
    expect(result.roles).toEqual([
      {
        kind: 'hotel_admin',
        hotelId: HOTEL_ID,
        hotelSlug: 'alpha',
        hotelName: 'Alpha Hotel',
      },
      {
        kind: 'hotel_user',
        hotelId: HOTEL_ID_2,
        hotelSlug: 'bravo',
        hotelName: 'Bravo Hotel',
      },
      {
        kind: 'business_admin',
        businessId: BUSINESS_ID,
        businessName: 'Sunrise Joyflights',
      },
    ]);
  });

  it('returns empty roles + isStrictonsStaff=false for a user with no memberships', async () => {
    const { supabase, queries } = makeMock({
      users: { data: { email: USER_EMAIL }, error: null },
      hotel_users: { data: [], error: null },
      business_users: { data: [], error: null },
      strictons_staff: { data: null, error: null },
    });

    const result = await getMembershipSet(supabase, USER_ID);

    expect(result.roles).toEqual([]);
    expect(result.isStrictonsStaff).toBe(false);
    // strictons_staff IS queried every call from commit 5 onwards;
    // RLS gates the visibility for non-staff (own row = none).
    expect(queries.map((q) => q.table)).toContain('strictons_staff');
  });

  it('returns isStrictonsStaff=true when the strictons_staff row is visible', async () => {
    // Staff users see their own row via the RLS SELECT policy
    // `using (is_strictons_staff())` (SECURITY DEFINER helper). Mocked
    // here as data: { user_id }.
    const { supabase, queries } = makeMock({
      users: { data: { email: USER_EMAIL }, error: null },
      hotel_users: { data: [], error: null },
      business_users: { data: [], error: null },
      strictons_staff: { data: { user_id: USER_ID }, error: null },
    });

    const result = await getMembershipSet(supabase, USER_ID);

    expect(result.isStrictonsStaff).toBe(true);
    expect(result.roles).toEqual([]);

    // Query shape: select user_id, filter on user_id = userId, maybeSingle.
    const staffQuery = queries.find((q) => q.table === 'strictons_staff');
    expect(staffQuery).toBeDefined();
    const calls = staffQuery!.chain.map((c) => `${c.method}(${JSON.stringify(c.args)})`);
    expect(calls).toContain(`eq(${JSON.stringify(['user_id', USER_ID])})`);
  });

  it('returns isStrictonsStaff=true AND populated roles for a staff user who is also a hotel admin', async () => {
    // The cross-role case Steven called out in commit 5's prompt: a
    // user who is both Strictons staff and a hotel admin should have
    // BOTH the role entry AND the staff flag — decideAuth's partners
    // allowWhen lets them through on either axis (regression test
    // for that lives in auth-helpers.test.ts).
    const { supabase } = makeMock({
      users: { data: { email: USER_EMAIL }, error: null },
      hotel_users: {
        data: [
          {
            is_admin: true,
            hotel_id: HOTEL_ID,
            hotels: { slug: 'alpha', name: 'Alpha Hotel' },
          },
        ],
        error: null,
      },
      business_users: { data: [], error: null },
      strictons_staff: { data: { user_id: USER_ID }, error: null },
    });

    const result = await getMembershipSet(supabase, USER_ID);

    expect(result.isStrictonsStaff).toBe(true);
    expect(result.roles).toEqual([
      {
        kind: 'hotel_admin',
        hotelId: HOTEL_ID,
        hotelSlug: 'alpha',
        hotelName: 'Alpha Hotel',
      },
    ]);
  });

  it('throws when the strictons_staff query errors', async () => {
    const { supabase } = makeMock({
      users: { data: { email: USER_EMAIL }, error: null },
      hotel_users: { data: [], error: null },
      business_users: { data: [], error: null },
      strictons_staff: { data: null, error: new Error('staff query failed') },
    });

    await expect(getMembershipSet(supabase, USER_ID)).rejects.toThrow(/staff query failed/);
  });

  it('filters hotel_users on revoked_at IS NULL and accepted_at IS NOT NULL', async () => {
    const { supabase, queries } = makeMock({
      users: { data: { email: USER_EMAIL }, error: null },
      hotel_users: { data: [], error: null },
      business_users: { data: [], error: null },
      strictons_staff: { data: null, error: null },
    });

    await getMembershipSet(supabase, USER_ID);

    const hotelQuery = queries.find((q) => q.table === 'hotel_users');
    expect(hotelQuery).toBeDefined();

    // Assert the query chain includes both filters in the right shape.
    const calls = hotelQuery!.chain.map((c) => `${c.method}(${JSON.stringify(c.args)})`);
    expect(calls).toContain(`is(${JSON.stringify(['revoked_at', null])})`);
    expect(calls).toContain(`not(${JSON.stringify(['accepted_at', 'is', null])})`);
    expect(calls).toContain(`eq(${JSON.stringify(['user_id', USER_ID])})`);
  });

  it('filters business_users on revoked_at IS NULL and accepted_at IS NOT NULL', async () => {
    const { supabase, queries } = makeMock({
      users: { data: { email: USER_EMAIL }, error: null },
      hotel_users: { data: [], error: null },
      business_users: { data: [], error: null },
      strictons_staff: { data: null, error: null },
    });

    await getMembershipSet(supabase, USER_ID);

    const businessQuery = queries.find((q) => q.table === 'business_users');
    expect(businessQuery).toBeDefined();

    const calls = businessQuery!.chain.map((c) => `${c.method}(${JSON.stringify(c.args)})`);
    expect(calls).toContain(`is(${JSON.stringify(['revoked_at', null])})`);
    expect(calls).toContain(`not(${JSON.stringify(['accepted_at', 'is', null])})`);
    expect(calls).toContain(`eq(${JSON.stringify(['user_id', USER_ID])})`);
  });

  it('produces hotel_admin and hotel_user kinds for the same user across different hotels', async () => {
    const { supabase } = makeMock({
      users: { data: { email: USER_EMAIL }, error: null },
      hotel_users: {
        data: [
          {
            is_admin: true,
            hotel_id: HOTEL_ID,
            hotels: { slug: 'alpha', name: 'Alpha Hotel' },
          },
          {
            is_admin: false,
            hotel_id: HOTEL_ID_2,
            hotels: { slug: 'bravo', name: 'Bravo Hotel' },
          },
        ],
        error: null,
      },
      business_users: { data: [], error: null },
      strictons_staff: { data: null, error: null },
    });

    const result = await getMembershipSet(supabase, USER_ID);

    const kinds = result.roles.map((r) => r.kind);
    expect(kinds).toEqual(['hotel_admin', 'hotel_user']);
  });

  it('produces both hotel and business kinds when the user is in both clusters', async () => {
    const { supabase } = makeMock({
      users: { data: { email: USER_EMAIL }, error: null },
      hotel_users: {
        data: [
          {
            is_admin: false,
            hotel_id: HOTEL_ID,
            hotels: { slug: 'alpha', name: 'Alpha Hotel' },
          },
        ],
        error: null,
      },
      business_users: {
        data: [
          {
            is_admin: true,
            business_id: BUSINESS_ID,
            businesses: { display_name: 'Sunrise Joyflights' },
          },
        ],
        error: null,
      },
      strictons_staff: { data: null, error: null },
    });

    const result = await getMembershipSet(supabase, USER_ID);

    const kinds = result.roles.map((r) => r.kind).sort();
    expect(kinds).toEqual(['business_admin', 'hotel_user']);
  });

  it('throws a clear error when the user is missing from public.users', async () => {
    const { supabase } = makeMock({
      users: { data: null, error: null },
      hotel_users: { data: [], error: null },
      business_users: { data: [], error: null },
      strictons_staff: { data: null, error: null },
    });

    await expect(getMembershipSet(supabase, USER_ID)).rejects.toThrow(/not found in public\.users/);
  });

  it('runs the four queries in parallel (single Promise.all batch)', async () => {
    const resolvers = new Map<string, (v: TableResponse) => void>();

    const supabase = {
      from: vi.fn((table: string) => {
        const builder = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(
            () =>
              new Promise<TableResponse>((resolve) => {
                resolvers.set(table, resolve);
              }),
          ),
          then: <T>(
            onFulfilled: (value: TableResponse) => T,
            onRejected?: (reason: unknown) => T,
          ) => {
            return new Promise<TableResponse>((resolve) => {
              resolvers.set(table, resolve);
            }).then(onFulfilled, onRejected);
          },
        };
        return builder;
      }),
    } as unknown as SupabaseClient<Database>;

    const promise = getMembershipSet(supabase, USER_ID);

    // After a single microtask flush, all four from() calls must already
    // have happened — proving the queries were issued in parallel rather
    // than sequentially. (Sequential awaits would only have called the
    // first from() at this point.)
    await Promise.resolve();
    expect(supabase.from).toHaveBeenCalledTimes(4);
    expect(resolvers.has('users')).toBe(true);
    expect(resolvers.has('hotel_users')).toBe(true);
    expect(resolvers.has('business_users')).toBe(true);
    expect(resolvers.has('strictons_staff')).toBe(true);

    resolvers.get('users')!({ data: { email: USER_EMAIL }, error: null });
    resolvers.get('hotel_users')!({ data: [], error: null });
    resolvers.get('business_users')!({ data: [], error: null });
    resolvers.get('strictons_staff')!({ data: null, error: null });

    const result = await promise;
    expect(result.email).toBe(USER_EMAIL);
  });
});
