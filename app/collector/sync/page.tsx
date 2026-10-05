import { SyncCenter } from '@/components/offline/sync-center';

export default function CollectorSyncPage() {
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Sync</h1>
      <p className="mb-4 text-sm text-[#5E6B64]">What this phone has saved, what is waiting for the server, and what needs your attention.</p>
      <SyncCenter />
    </>
  );
}
