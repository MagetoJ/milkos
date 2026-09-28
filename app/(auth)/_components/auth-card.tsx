import type { ReactNode } from 'react'

export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md p-6 bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}