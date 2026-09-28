import type { Cooperative } from '../_types/cooperative-types'

const pendingCooperatives: Cooperative[] = [
  { id: 'COOP-104', name: 'Mwangaza Dairy Cooperative', location: 'Nakuru', memberCount: 48, status: 'Pending' },
  { id: 'COOP-103', name: 'Upendo Milk Union', location: 'Kiambu', memberCount: 72, status: 'Pending' },
  { id: 'COOP-102', name: 'Baraka Farmers Cooperative', location: 'Nyeri', memberCount: 31, status: 'Needs review' },
]

export function CooperativeList() {
  return (
    <ul className="divide-y divide-[#e4e9e7] rounded-xl border border-[#e4e9e7] bg-white">
      {pendingCooperatives.map((cooperative) => (
        <li key={cooperative.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <h2 className="text-sm font-bold text-[#14231e]">{cooperative.name}</h2>
            <p className="mt-1 text-xs text-[#53645d]">{cooperative.location} · {cooperative.memberCount} members</p>
          </div>
          <span className="rounded-full bg-[#fff4dc] px-3 py-1 text-xs font-semibold text-[#80520c]">{cooperative.status}</span>
        </li>
      ))}
    </ul>
  )
}