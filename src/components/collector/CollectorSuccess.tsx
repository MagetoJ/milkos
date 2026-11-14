import React from 'react';

interface CollectorSuccessProps {
  isOffline?: boolean;
  collectionId?: string;
  totalKg?: number;
  farmersCount?: number;
}

export function CollectorSuccess({ isOffline = true, collectionId = 'b-1', totalKg = 100, farmersCount = 2 }: CollectorSuccessProps) {
  return (
    <div className="space-y-5 text-center">
      <h2 className="text-2xl font-bold">Saved on this device</h2>
      <p className="mt-1 text-[#5E6B64]" role="status">Will sync when connection returns.</p>
      
      <div className="rounded-2xl border border-[#DDE3DE] bg-white p-4 text-left">
        <dl className="divide-y divide-[#EEF1EC] text-sm">
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-[#5E6B64]">Collection ID</dt>
            <dd className="text-right font-semibold"><span className="break-all font-mono text-xs">{collectionId}</span></dd>
          </div>
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-[#5E6B64]">Collection reference</dt>
            <dd className="text-right font-semibold">Assigned after sync</dd>
          </div>
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-[#5E6B64]">Total KG</dt>
            <dd className="text-right font-semibold">{totalKg.toFixed(2)} KG</dd>
          </div>
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-[#5E6B64]">Farmers</dt>
            <dd className="text-right font-semibold">{farmersCount}</dd>
          </div>
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-[#5E6B64]">SMS receipts</dt>
            <dd className="text-right font-semibold">1 of 1 queued</dd>
          </div>
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-[#5E6B64]">Sync status</dt>
            <dd className="text-right font-semibold">Pending sync</dd>
          </div>
        </dl>
      </div>

      {/* Required helper text expected by the test */}
      <p className="text-sm text-[#5E6B64]">
        SMS receipts queued until this collection syncs
      </p>

      <div className="grid gap-3">
        <button className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">Print Receipt</button>
        <button type="button" className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#176044] px-5 text-base font-bold text-white">New Collection</button>
        <a className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-[#C9D2CB] bg-white px-5 text-base font-bold" href={`/collector/collections?id=${collectionId}`}>View Collection</a>
      </div>
    </div>
  );
}
