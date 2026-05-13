import { NextResponse, type NextRequest } from 'next/server';
import { findMemoryInboxEntry } from '@strictons/email/transports';

/**
 * GET /api/test/last-email?to=<email>
 *
 * Test-only inbox reader for the admin app's E2E suite. Returns the
 * most recent rendered email sent to the given address from the
 * in-process memory transport, so Playwright can extract magic-link
 * URLs (admin sign-in OR staff-initiated hotel-admin invite) without
 * parsing real emails.
 *
 * E2E_MODE gate: matches the partners-side gate exactly (Phase 3
 * commit 12 / Phase 5 commit 6). Production / preview deploys
 * silently 404 because E2E_MODE is unset there. Defence in depth
 * with the memory transport itself, which throws if E2E_MODE!=1.
 *
 * Path note: segment is `test` (not `_test`) per the Next.js App
 * Router routing-exclusion gotcha — underscore-prefixed folders
 * silently 404. The partners-side route has the same comment.
 *
 * Response carries rendered fields only (to, from, subject, text,
 * html); no transport state, no audit identifiers.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (process.env.E2E_MODE !== '1') {
    return new NextResponse('Not Found', { status: 404 });
  }

  const url = new URL(request.url);
  const to = url.searchParams.get('to');
  if (!to) {
    return NextResponse.json({ error: 'missing ?to' }, { status: 400 });
  }

  const entry = findMemoryInboxEntry(to);
  if (!entry) {
    return NextResponse.json({ entry: null }, { status: 404 });
  }

  return NextResponse.json({
    entry: {
      to: entry.to,
      from: entry.from,
      subject: entry.subject,
      text: entry.text,
      html: entry.html,
    },
  });
}
