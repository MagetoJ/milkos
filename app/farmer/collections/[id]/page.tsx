import { FarmerCollectionDetailClient } from './collection-detail-client';

export function generateStaticParams() {
  return [];
}

export default async function FarmerCollectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FarmerCollectionDetailClient id={id} />;
}
