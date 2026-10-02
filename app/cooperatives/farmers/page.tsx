import { Suspense } from 'react';
import { FarmersView } from '../_components/farmers-view';

// useSearchParams (for ?new=1 style links) needs a Suspense boundary in the App Router.
export default function Page() {
  return (
    <Suspense>
      <FarmersView />
    </Suspense>
  );
}