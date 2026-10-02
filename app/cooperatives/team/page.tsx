import { Suspense } from 'react';
import { TeamView } from '../_components/team-view';

// useSearchParams (for ?new=1 style links) needs a Suspense boundary in the App Router.
export default function Page() {
  return (
    <Suspense>
      <TeamView />
    </Suspense>
  );
}