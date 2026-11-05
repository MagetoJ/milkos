// ./app/collector/_components/farmer-selector.tsx
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function FarmerSelector() {
  const [farmers, setFarmers] = useState<any[]>([]);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('farmers').select('id, name');
      if (data) setFarmers(data);
    }
    void load();
  }, []);

  return (
    <select className="border p-2 rounded">
      {farmers.map((f) => (
        <option key={f.id} value={f.id}>{f.name}</option>
      ))}
    </select>
  );
}