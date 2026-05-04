import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Strictons · Admin',
  description: 'Strictons internal admin portal.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-ink-50 text-ink-900 antialiased">{children}</body>
    </html>
  );
}
