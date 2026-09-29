'use client';

import { useEffect, useState } from 'react';
import { fetchActivity } from '../_api/superadmin-client';
import type { AuditEntry } from '../_types/superadmin-types';
import { formatDateTime, timeAgo } from '../_lib/format';
import { useSuperadminData } from './superadmin-data';

const LABELS: Record<string, { text: string; dot: string }> = {
  APPLICATION_APPROVED: { text: 'Approved cooperative', dot: 'bg-[#176044]' },
  APPLICATION_REJECTED: { text: 'Rejected application', dot: 'bg-[#B42318]' },
  PAYMENT_VERIFIED: { text: 'Issued SMS credits', dot: 'bg-[#176044]' },
  PAYMENT_REJECTED: { text: 'Rejected top-up', dot: 'bg-[#B42318]' },
};

function describe(action: string) {
  return LABELS[action] ?? { text: action.replace(/_/g, ' ').toLowerCase(), dot: 'bg-[#8A968F]' };
}

export function ActivityFeed({ limit = 8, detailed = false }: { limit?: number; detailed?: boolean }) {
  const { lastUpdated } = useSuperadminData();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState('');

  // Reload whenever the shared data refreshes (including right after a decision).
  useEffect(() => {
    let cancelled = false;
    fetchActivity(limit)
      .then((rows) => !cancelled && (setEntries(rows), setError('')))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load activity.'));
    return () => {
      cancelled = true;
    };
  }, [limit, lastUpdated]);

  if (error) return <p className="px-5 py-6 text-sm text-[#B42318]">{error}</p>;
  if (!entries) return <p className="px-5 py-6 text-sm text-[#5E6B64]">Loading activity…</p>;
  if (entries.length === 0) {
    return <p className="px-5 py-6 text-sm text-[#5E6B64]">No decisions recorded yet. Approvals and rejections will be logged here.</p>;
  }

  return (
    <ol className="divide-y divide-[#EEF1EC]">
      {entries.map((e) => {
        const { text, dot } = describe(e.action);
        return (
          <li key={e.id} className="flex gap-3 px-5 py-3">
            <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} />
            <div className="min-w-0 flex-1 text-sm">
              <p>
                <span className="font-medium">{text}</span> <span className="text-[#5E6B64]">·</span> {e.target}
              </p>
              <p className="text-xs text-[#5E6B64]">
                <time dateTime={e.created_at} title={formatDateTime(e.created_at)}>
                  {detailed ? formatDateTime(e.created_at) : timeAgo(e.created_at)}
                </time>
                {e.admin_email && <> by {e.admin_email}</>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
