import { Suspense } from 'react';
import { CooperativeDetailView } from '../../_components/views/cooperative-detail';

export function generateStaticParams() {
  return [];
}

export default async function CooperativePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense>
      <CooperativeDetailView key={id} id={id} />
    </Suspense>
  );
}
