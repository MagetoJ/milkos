import { Suspense } from 'react';
import { FarmersView } from '../_components/views/farmers-view';

// The view reads ?focus= / filters from the URL, which needs a Suspense boundary in the App Router.
export default function Page() {
  return (
    <Suspense>
      <FarmersView />
    </Suspense>
  );
}
