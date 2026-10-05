'use client';

// Farmers the collector can collect from: searchable by name, farmer number or phone, from this phone's data.
import { useState } from 'react';
import { Phone, Search } from 'lucide-react';
import { searchFarmers } from '@/lib/collections/batch-client';
import { formatPhone } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useLocalQuery } from '@/lib/sync/hooks';
import { bigInput, Notice } from '../_components/ui';

export default function CollectorFarmersPage() {
  const [term, setTerm] = useState('');
  const search = useDebounced(term, 200);
  const farmers = useLocalQuery(() => searchFarmers(search, 100), ['farmers'], [search]);
  return (
    <div>
      <h1 className="text-2xl font-bold">Farmers</h1>
      <div className="relative mt-3">
        <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#8A968F]" />
        <label htmlFor="farmer-filter" className="sr-only">Search farmers by name, number or phone</label>
        <input id="farmer-filter" type="search" className={`${bigInput} pl-12`} placeholder="Name, number or phone" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      {farmers.error && <div className="mt-3"><Notice tone="red">{farmers.error}</Notice></div>}
      <ul className="mt-3 divide-y divide-[#EEF1EC] rounded-2xl border border-[#DDE3DE] bg-white" aria-busy={!farmers.data}>
        {farmers.data?.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block truncate font-semibold">{f.full_name}</span>
              <span className="text-xs text-[#5E6B64]">{f.farmer_number}</span>
            </span>
            {f.phone && (
              <span className="inline-flex shrink-0 items-center gap-1 text-sm text-[#3C4A43]">
                <Phone aria-hidden className="size-4" /> {formatPhone(f.phone)}
              </span>
            )}
          </li>
        ))}
        {farmers.data?.length === 0 && <li className="p-4 text-sm text-[#5E6B64]">No active farmers match.</li>}
      </ul>
      <p className="mt-3 text-center text-xs text-[#8A968F]">Farmers are registered by your cooperative office.</p>
    </div>
  );
}
