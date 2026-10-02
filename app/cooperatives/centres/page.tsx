import { Suspense } from 'react';
import { CentresView } from '../_components/centres-view';

// useSearchParams (for ?new=1 style links) needs a Suspense boundary in the App Router.
export default function Page() {
  return (
    <Suspense>
      <CentresView />
    </Suspense>
  );
}