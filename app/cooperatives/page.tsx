import { CooperativeList } from './_components/cooperative-list'

export default function CooperativesPage() {
  return (
    <main className="min-h-screen bg-[#f6f9f7] px-5 py-10 text-[#14231e] sm:px-10">
      <div className="mx-auto max-w-5xl">
        <a href="/" className="text-sm font-semibold text-[#176044]">Milkflow</a>
        <div className="mb-6 mt-8">
          <p className="text-xs font-bold uppercase tracking-widest text-[#60716c]">Governance</p>
          <h1 className="mt-2 text-3xl font-bold">Cooperatives</h1>
          <p className="mt-2 text-sm text-[#53645d]">Review cooperative applications and membership details.</p>
        </div>
        <CooperativeList />
      </div>
    </main>
  )
}