'use client';

import { NotificationsView } from '../_components/notifications-view';
import { useCoop } from '../_components/coop-context';

export default function Page() {
  const { refresh } = useCoop();
  return <NotificationsView onChange={() => void refresh()} />;
}
