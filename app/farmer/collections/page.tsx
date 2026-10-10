'use client';

import { useEffect, useState } from 'react';
import { Notice } from '@/components/settings/settings-ui';
import { listMyCollections, type FarmerCollection } from '@/lib/farmer/api';
import { ApiError } from '@/lib/api-client';
import { CollectionRow } from '../_components/farmer-ui';

export default function FarmerCollectionsPage() {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<FarmerCollection[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listMyCollections(page, 20)
      .then((r) => { setItems((prev) => (page === 1 ? r.items : [...prev, ...r.items])); setTotal(r.total); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load your deliveries.'))
      .finally(() => setLoading(false));
  }, [page]);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Deliveries</h1>
      <p className="mb-4 text-sm text-mo-muted">Every collection recorded for you. Tap one for details.</p>
      {error && <Notice tone="danger">{error}</Notice>}
      {items.length > 0 && <ul className="divide-y divide-mo-line rounded-2xl border border-mo-line bg-white">{items.map((c) => <CollectionRow key={c.id} c={c} />)}</ul>}
      {!loading && items.length === 0 && !error && <p className="text-sm text-mo-muted">No deliveries recorded yet.</p>}
      {loading && <p role="status" className="mt-3 text-sm text-mo-muted">Loading…</p>}
      {items.length < total && !loading && (
        <button onClick={() => setPage((p) => p + 1)} className="mt-4 min-h-12 w-full rounded-xl border border-mo-line-strong bg-white font-semibold">Show more</button>
      )}
    </div>
  );
}
