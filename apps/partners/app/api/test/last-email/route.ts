import { NextResponse, type NextRequest } from 'next/server';
import { findMemoryInboxEntry } from '@strictons/email/transports';

/**
 * GET /api/test/last-email?to=<email>
 *
 * Test-only inbox reader. Returns the most recent rendered email sent
 * to the given address from the in-process memory transport, so
 * Playwright can extract the magic-link URL without parsing real
 * emails.
 *
 * Path note: the segment is `test` (not `_test`) because Next.js App
 * Router silently excludes any folder prefixed with `_` from routing.
 * The earlier `_test` shape compiled fine but was never mounted, so
 * Playwright's polling loop saw Next's default 404 page every iteration.
 *
 * Gated by E2E_MODE=1 — production / preview deploys silently 404.
 * This is the same gate the memory transport itself uses (refuses to
 * load without E2E_MODE=1), so production is doubly protected:
 *
 *   - the memory transport throws if E2E_MODE!=1
 *   - this handler 404s if E2E_MODE!=1
 *
 * The response contains rendered fields only (to, subject, text, html);
 * no transport state and no audit identifiers.
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
