import React from 'react';

export async function generateStaticParams() {
  try {
    // Attempt to fetch cooperatives if an API or data layer exists
    const cooperatives: { id: string }[] = []; // Fallback empty array simulation

    if (!cooperatives || cooperatives.length === 0) {
      return [{ id: 'placeholder' }];
    }

    return cooperatives.map((coop) => ({
      id: coop.id.toString(),
    }));
  } catch {
    // Fallback parameter for static export if fetch fails during build
    return [{ id: 'placeholder' }];
  }
}

interface PageProps {
  params: Promise<{ id: string }> | { id: string };
}

export default async function CooperativeDetailPage({ params }: PageProps) {
  const resolvedParams = await Promise.resolve(params);
  const id = resolvedParams.id;

  if (id === 'placeholder') {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold">Cooperative Details</h1>
        <p className="text-gray-500 mt-2">Loading cooperative information...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold">Cooperative ID: {id}</h1>
      {/* Real dynamic page content goes here */}
    </div>
  );
}
