import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServiceRoleClient } from '@strictons/db/client';
import type { HotelApprovalState } from '@strictons/types/hotels';
import { HotelForm } from '../HotelForm';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export default async function EditHotelPage({
  params,
}: {
  params: Params;
}): Promise<React.ReactElement> {
  const { id } = await params;

  const service = createServiceRoleClient();
  const { data: hotel, error } = await service
    .from('hotels')
    .select('id, slug, name, contact_email, approval_state, custom_domain')
    .eq('id', id)
    .maybeSingle();

  if (error || !hotel) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="mb-6">
        <Link href="/hotels" className="text-sm text-neutral-600 underline">
          ← Hotels
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{hotel.name}</h1>
        <p className="mt-1 text-xs text-neutral-600">
          <code>{hotel.slug}</code>
        </p>
      </header>
      <HotelForm
        mode="edit"
        hotelId={hotel.id}
        initial={{
          name: hotel.name,
          slug: hotel.slug,
          contact_email: hotel.contact_email,
          approval_state: hotel.approval_state as HotelApprovalState,
          custom_domain: hotel.custom_domain,
        }}
        submitLabel="Save changes"
        pendingLabel="Saving…"
      />
    </main>
  );
}
