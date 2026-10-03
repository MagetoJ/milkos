import { Suspense } from 'react';
import { CoolersView } from '../_components/views/coolers-view';

// The view reads ?focus= / filters from the URL, which needs a Suspense boundary in the App Router.
export default function Page() {
  return (
    <Suspense>
      <CoolersView />
    </Suspense>
  );
}
