import { Suspense } from 'react';
import { CooperativesView } from '../_components/views/cooperatives-view';

// The view reads ?focus= / filters from the URL, which needs a Suspense boundary in the App Router.
export default function Page() {
  return (
    <Suspense>
      <CooperativesView />
    </Suspense>
  );
}
