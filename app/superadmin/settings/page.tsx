import { Suspense } from 'react';
import { SettingsView } from '../_components/views/settings-view';

// The view reads ?focus= / filters from the URL, which needs a Suspense boundary in the App Router.
export default function Page() {
  return (
    <Suspense>
      <SettingsView />
    </Suspense>
  );
}
