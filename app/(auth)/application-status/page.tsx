import { Suspense } from 'react';
import { StatusForm } from './status-form';

export const metadata = { title: 'Application status · MilkOS' };

/** Static page: `?reference=` is read in the browser (see StatusForm), so the page also works in a static export. */
export default function ApplicationStatusPage() {
  return (
    <Suspense>
      <StatusForm />
    </Suspense>
  );
}
