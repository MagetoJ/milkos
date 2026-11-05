// ./app/collections/page.tsx
import { createClient } from '@/lib/supabase/server';

export default async function CollectionsPage() {
  const supabase = await createClient();
  const { data: collections } = await supabase.from('collections').select('*');

  return (
    <main className="p-6">
      <h1 className="text-xl font-bold">Milk Collections</h1>
      <ul>
        {collections?.map((item) => (
          <li key={item.id}>{item.reference} - {item.liters}L</li>
        ))}
      </ul>
    </main>
  );
}