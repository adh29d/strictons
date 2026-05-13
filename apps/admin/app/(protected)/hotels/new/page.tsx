import Link from 'next/link';
import { HotelForm } from '../HotelForm';

export const dynamic = 'force-dynamic';

export default function NewHotelPage(): React.ReactElement {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="mb-6">
        <Link href="/hotels" className="text-sm text-neutral-600 underline">
          ← Hotels
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Add hotel</h1>
      </header>
      <HotelForm mode="create" submitLabel="Create hotel" pendingLabel="Creating…" />
    </main>
  );
}
