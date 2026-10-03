import { Suspense } from 'react';
import { PaymentsView } from '../_components/views/payments-view';

// The view reads ?focus= / filters from the URL, which needs a Suspense boundary in the App Router.
export default function Page() {
  return (
    <Suspense>
      <PaymentsView />
    </Suspense>
  );
}
