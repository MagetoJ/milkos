import { Suspense } from 'react';
import { CollectorsView } from '../_components/views/collectors-view';

// The view reads ?focus= / filters from the URL, which needs a Suspense boundary in the App Router.
export default function Page() {
  return (
    <Suspense>
      <CollectorsView />
    </Suspense>
  );
}
