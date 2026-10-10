'use client';

// "More" tab (spec sections 16 and 34): everything that is not Home, Collections, Farmers or Sync.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, ChevronRight, LogOut, Settings, type LucideIcon } from 'lucide-react';
import { inboxCount } from '@/app/cooperatives/_api/finance-client';
import { useIsOnline } from '@/lib/sync/hooks';
import { useCollector } from '../_components/collector-context';
import { Card } from '../_components/ui';

const row = 'flex min-h-14 w-full items-center gap-3 px-4 text-left text-base font-medium outline-none focus-visible:bg-[#EEF1EC] active:bg-[#EEF1EC]';

function LinkRow({ href, icon: Icon, label, note }: { href: string; icon: LucideIcon; label: string; note?: string }) {
  return (
    <li>
      <Link href={href} className={row}>
        <Icon aria-hidden className="size-6 shrink-0 text-[#5E6B64]" />
        <span className="flex-1">{label}</span>
        {note && <span className="rounded-full bg-[#B42318] px-2 py-0.5 text-xs font-bold text-white">{note}</span>}
        <ChevronRight aria-hidden className="size-5 text-[#8A968F]" />
      </Link>
    </li>
  );
}

export default function CollectorMore() {
  const { name, signOut } = useCollector();
  const online = useIsOnline();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    inboxCount().then((r) => !cancelled && setUnread(r.unread), () => undefined);
    return () => { cancelled = true; };
  }, [online]);

  return (
    <div>
      <h1 className="text-2xl font-bold">More</h1>
      {name && <p className="text-sm text-[#5E6B64]">Signed in as {name}</p>}
      <Card className="mt-4 overflow-hidden p-0">
        <ul className="divide-y divide-[#EEF1EC]">
          <LinkRow href="/collector/notifications" icon={Bell} label="Notifications" note={unread ? (unread > 99 ? '99+' : String(unread)) : undefined} />
          <LinkRow href="/collector/settings" icon={Settings} label="Settings" />
        </ul>
      </Card>
      <Card className="mt-4 overflow-hidden p-0">
        <button type="button" onClick={signOut} className={`${row} text-[#B42318]`}>
          <LogOut aria-hidden className="size-6 shrink-0" />
          Sign out
        </button>
      </Card>
      <p className="mt-3 text-sm text-[#5E6B64]">Unsynced collections stay on this phone when you sign out, and sync after you sign in again.</p>
    </div>
  );
}
