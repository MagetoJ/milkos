import { PageHeader } from '@/components/admin';
import { SyncCenter } from '@/components/offline/sync-center';

export default function Page() {
  return (
    <>
      <PageHeader title="Sync center" subtitle="What this device has saved, what is waiting for the server, and what needs your review." />
      <SyncCenter />
    </>
  );
}
