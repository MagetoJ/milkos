import { Suspense } from 'react';
import { UsersView } from '../_components/views/users-view';

// The view reads ?focus= / filters from the URL, which needs a Suspense boundary in the App Router.
export default function Page() {
  return (
    <Suspense>
      <UsersView />
    </Suspense>
  );
}
