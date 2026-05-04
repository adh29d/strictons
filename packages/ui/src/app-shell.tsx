import type { ReactNode } from 'react';

type AppShellProps = {
  appName: string;
  children?: ReactNode;
};

export function AppShell({ appName, children }: AppShellProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Strictons · {appName}</h1>
      <p className="text-sm text-ink-500">
        Phase 1 placeholder. Real product surfaces land from Phase 4 onwards.
      </p>
      {children}
    </main>
  );
}
