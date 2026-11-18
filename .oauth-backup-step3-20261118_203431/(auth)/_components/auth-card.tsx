import type { ReactNode } from 'react';

export function AuthCard({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} p-6 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl !text-white`}>
      <div className="mb-6">
        <h1 className="text-xl font-extrabold text-white">{title}</h1>
        <p className="text-xs text-zinc-300 mt-1">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}