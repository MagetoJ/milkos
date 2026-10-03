'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { CooperativeDetailView } from '../../_components/views/cooperative-detail';

export default function CooperativePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Suspense>
      <CooperativeDetailView key={id} id={id} />
    </Suspense>
  );
}
