'use client';

// Notifications that concern this collector: outcomes of their correction requests, offline changes the
// server refused, and cooler alerts for their cooperative. Needs a connection.
import { useState } from 'react';
import { AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import { listInbox, markInboxRead } from '@/app/cooperatives/_api/finance-client';
import { formatDateTime } from '@/lib/format';
import { useResource } from '@/lib/hooks/use-resource';
import { Button, Notice } from '../_components/ui';

const ICON = { CRITICAL: AlertOctagon, WARNING: AlertTriangle, INFO: Info } as const;

export default function CollectorNotificationsPage() {
  const [page, setPage] = useState(1);
  const inbox = useResource(() => listInbox({ page, page_size: 20 }), [page]);
  return (
    <div>
      <h1 className="text-2xl font-bold">Notifications</h1>
      {inbox.error && <div className="mt-3"><Notice tone="amber">Notifications need a connection. {inbox.error}</Notice></div>}
      {inbox.data && inbox.data.unread > 0 && (
        <Button variant="medium" className="mt-3" onClick={() => void markInboxRead().then(() => inbox.reload())}>Mark all read</Button>
      )}
      <ul className="mt-3 space-y-2">
        {inbox.data?.items.map((n) => {
          const Icon = ICON[n.severity] ?? Info;
          return (
            <li key={n.id} className={`flex gap-3 rounded-2xl border bg-white p-4 ${n.read ? 'border-[#DDE3DE]' : 'border-[#176044]'}`}>
              <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-[#5E6B64]" />
              <div className="min-w-0">
                <p className={n.read ? '' : 'font-bold'}><span className="sr-only">{n.severity.toLowerCase()}: </span>{n.title}</p>
                {n.body && <p className="text-sm text-[#5E6B64]">{n.body}</p>}
                <p className="mt-1 text-xs text-[#8A968F]">{formatDateTime(n.created_at)}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {inbox.data?.items.length === 0 && <p className="mt-6 text-center text-sm text-[#5E6B64]">No notifications.</p>}
      {inbox.data && inbox.data.total > page * 20 && <Button variant="medium" className="mt-3 w-full" onClick={() => setPage(page + 1)}>Older</Button>}
    </div>
  );
}
