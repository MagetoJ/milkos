import { Suspense } from 'react';
import { AuditView } from '../_components/views/audit-view';

// The view reads ?focus= / filters from the URL, which needs a Suspense boundary in the App Router.
export default function Page() {
  return (
    <Suspense>
      <AuditView />
    </Suspense>
  );
}
