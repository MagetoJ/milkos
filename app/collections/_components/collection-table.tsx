import type { CollectionRecord } from '../_types/collection-types'

const demoCollections: CollectionRecord[] = [
  { id: 'COL-1048', farmer: 'Ramesh Kumar', volumeLitres: 24.6, fatPercent: 4.2, snfPercent: 8.7, amount: 1107, status: 'Synced' },
  { id: 'COL-1047', farmer: 'Meena Devi', volumeLitres: 18.2, fatPercent: 4.6, snfPercent: 8.9, amount: 865, status: 'Synced' },
  { id: 'COL-1046', farmer: 'Suresh Patil', volumeLitres: 31.4, fatPercent: 3.8, snfPercent: 8.4, amount: 1319, status: 'Pending' },
]

export function CollectionTable() {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#e4e9e7] bg-white">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="bg-[#f6f9f7] text-xs uppercase text-[#53645d]">
          <tr>{['Collection', 'Farmer', 'Volume', 'Quality', 'Amount', 'Status'].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr>
        </thead>
        <tbody>
          {demoCollections.map((record) => (
            <tr key={record.id} className="border-t border-[#e4e9e7] text-[#243630]">
              <td className="px-4 py-3 font-mono text-xs">{record.id}</td>
              <td className="px-4 py-3 font-semibold">{record.farmer}</td>
              <td className="px-4 py-3">{record.volumeLitres.toFixed(1)} L</td>
              <td className="px-4 py-3">Fat {record.fatPercent}% · SNF {record.snfPercent}%</td>
              <td className="px-4 py-3">KSh {record.amount.toLocaleString()}</td>
              <td className="px-4 py-3">{record.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}