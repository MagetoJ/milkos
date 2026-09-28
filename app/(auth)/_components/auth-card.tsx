import type { ReactNode } from 'react'

export function AuthCard({ title, description, children }: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <main className="auth-bg flex min-h-screen items-center justify-center px-4 py-8">
      <section className="w-full max-w-md rounded-2xl border p-7 shadow-2xl sm:p-9">
        <a href="/" className="text-sm font-bold tracking-tight text-[#9ed3b7]">Milkflow</a>
        <p className="mt-7 text-[10px] font-bold uppercase tracking-[.16em] text-[#d1e1d8]">Collection OS</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[#d1e1d8]">{description}</p>
        <div className="mt-7">{children}</div>
      </section>
    </main>
  )
}