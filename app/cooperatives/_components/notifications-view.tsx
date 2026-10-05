'use client';

// Notification center: cooler alerts, SMS failures, correction requests, payment events and sync problems
// that concern you. The server decides what you may see (your cooperative, your role, things addressed to you).
import { useState } from 'react';
import Link from 'next/link';
import { AlertOctagon, AlertTriangle, Bell, CheckCheck, Info } from 'lucide-react';
import { EmptyState, ErrorState, FilterBar, FilterSelect, PageHeader, Pagination, secondaryButton } from '@/components/admin';
import { formatDateTime, humanize } from '@/lib/format';
import { useResource } from '@/lib/hooks/use-resource';
import { listInbox, markInboxRead, type InboxItem } from '../_api/finance-client';

const SEVERITY = {
  CRITICAL: { Icon: AlertOctagon, label: 'Critical', tone: 'text-[#B42318]' },
  WARNING: { Icon: AlertTriangle, label: 'Warning', tone: 'text-[#8A5A0B]' },
  INFO: { Icon: Info, label: 'Info', tone: 'text-[#1F4E86]' },
} as const;

export function NotificationsView({ onChange }: { onChange?: () => void }) {
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [unread, setUnread] = useState(false);
  const inbox = useResource(() => listInbox({ page, page_size: 20, ...(category ? { category } : {}), ...(unread ? { unread_only: true } : {}) }), [page, category, unread]);

  async function read(ids?: string[]) {
    await markInboxRead(ids);
    void inbox.reload();
    onChange?.();
  }

  if (inbox.error && !inbox.data) return <ErrorState message={inbox.error} onRetry={inbox.reload} />;
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Alerts and events for your cooperative and your role."
        action={inbox.data && inbox.data.unread > 0 && (
          <button className={secondaryButton} onClick={() => void read()}><CheckCheck aria-hidden className="size-4" /> Mark all read</button>
        )}
      />
      <div className="mb-4 rounded-xl border border-[#DDE3DE] bg-white px-4 py-3">
        <FilterBar>
          <FilterSelect label="Category" value={category} onChange={(v) => (setCategory(v), setPage(1))} allLabel="All categories"
            options={['COOLER', 'SMS', 'COLLECTION', 'PAYMENT', 'SYNC', 'SYSTEM'].map((c) => ({ value: c, label: humanize(c) }))} />
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[#176044]" checked={unread} onChange={(e) => (setUnread(e.target.checked), setPage(1))} /> Unread only
          </label>
        </FilterBar>
      </div>
      {inbox.data && inbox.data.items.length === 0 ? (
        <EmptyState icon={<Bell className="size-8" />} title="No notifications" />
      ) : (
        <ul className="divide-y divide-[#EEF1EC] rounded-xl border border-[#DDE3DE] bg-white" aria-busy={inbox.loading}>
          {inbox.data?.items.map((n) => <Item key={n.id} item={n} onRead={() => void read([n.id])} />)}
        </ul>
      )}
      <Pagination page={page} pageSize={20} total={inbox.data?.total ?? 0} onPage={setPage} />
    </>
  );
}

function Item({ item: n, onRead }: { item: InboxItem; onRead: () => void }) {
  const s = SEVERITY[n.severity] ?? SEVERITY.INFO;
  return (
    <li className={`flex gap-3 px-4 py-3 ${n.read ? '' : 'bg-[#F6FAF7]'}`}>
      <s.Icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${s.tone}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="sr-only">{s.label}: </span>
          <span className={n.read ? '' : 'font-semibold'}>{n.title}</span>
          {!n.read && <span className="ml-2 rounded-full bg-[#176044] px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">New</span>}
        </p>
        {n.body && <p className="text-sm text-[#5E6B64]">{n.body}</p>}
        <p className="mt-0.5 text-xs text-[#8A968F]">{humanize(n.category)} · {formatDateTime(n.created_at)}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {n.link && <Link href={n.link} onClick={onRead} className="text-sm font-medium text-[#176044] hover:underline">Open</Link>}
        {!n.read && <button onClick={onRead} className="text-xs text-[#5E6B64] hover:underline">Mark read</button>}
      </div>
    </li>
  );
}
