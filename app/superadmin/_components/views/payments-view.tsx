'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CreditCard } from 'lucide-react';
import {
  ConfirmationDialog,
  DataTable,
  DetailList,
  DetailPanel,
  DetailRow,
  DetailSection,
  EmptyState,
  ErrorBanner,
  FilterBar,
  FilterSelect,
  LoadingState,
  Pagination,
  PrimaryCell,
  SearchInput,
  StatusBadge,
  Tabs,
  dangerButton,
  primaryButton,
  type Column,
} from '@/components/admin';
import { formatDateTime, formatKes, formatNumber, waitingFor } from '@/lib/format';
import { useListState } from '@/lib/hooks/use-list-state';
import { useResource } from '@/lib/hooks/use-resource';
import { getPayment, listPayments, verifyPayment } from '../../_api/superadmin-client';
import type { Payment, PaymentStatus } from '../../_types/platform-types';
import { useSuperadminData } from '../superadmin-data';
import { useToast } from '../toast';
import { AuditTrail, useCooperativeOptions, useFocusParam } from './common';

export function PaymentsView({ cooperativeId, embedded }: { cooperativeId?: string; embedded?: boolean }) {
  const list = useListState({ filters: { status: embedded ? '' : 'PENDING', cooperative_id: cooperativeId ?? '' } });
  const data = useResource(() => listPayments(list.params), [JSON.stringify(list.params)]);
  const coops = useCooperativeOptions(!cooperativeId);
  const [focus, setFocus] = useFocusParam();
  const s = data.data?.summary;

  const columns: Column<Payment>[] = [
    { key: 'coop', header: 'Cooperative', sortKey: 'cooperative', hidden: !!cooperativeId, cell: (p) => <PrimaryCell title={p.cooperative_name ?? 'Unknown'} subtitle={p.cooperative_code ?? undefined} /> },
    { key: 'credits', header: 'Credits', sortKey: 'credits_requested', align: 'right', cell: (p) => formatNumber(p.credits_requested) },
    { key: 'amount', header: 'Amount', sortKey: 'amount_kes', align: 'right', cell: (p) => formatKes(p.amount_kes) },
    { key: 'ref', header: 'M-Pesa code', cell: (p) => <code className="rounded bg-[#EEF1EC] px-1.5 py-0.5 text-xs">{p.masked_mpesa_ref}</code> },
    { key: 'package', header: 'Package', cell: (p) => p.package_name ?? 'Custom' },
    { key: 'submitted', header: 'Submitted', sortKey: 'submitted_at', cell: (p) => (p.status === 'PENDING' && p.submitted_at ? `${waitingFor(p.submitted_at)} ago` : formatDateTime(p.submitted_at)) },
    { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
  ];

  const tab = (list.filters.status || 'ALL') as PaymentStatus | 'ALL';

  return (
    <>
      {!embedded && (
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Payments &amp; SMS credits</h1>
          <p className="mt-1 text-[#5E6B64]">M-Pesa top-ups for SMS credits. Match each code and amount against the paybill statement before verifying.</p>
        </div>
      )}
      <Tabs
        active={tab}
        onChange={(v) => list.setFilter('status', v === 'ALL' ? '' : v)}
        tabs={[
          { value: 'PENDING', label: 'Pending', count: s?.pending.count },
          { value: 'VERIFIED', label: 'Verified', count: s?.verified.count },
          { value: 'REJECTED', label: 'Rejected', count: s?.rejected.count },
          { value: 'CANCELLED', label: 'Cancelled', count: s?.cancelled?.count },
          { value: 'ALL', label: 'All' },
        ]}
      />
      <DataTable
        columns={columns}
        rows={data.data?.items}
        rowKey={(p) => p.id}
        loading={data.loading}
        error={data.error}
        onRetry={data.reload}
        sort={list.sort}
        onSort={list.setSort}
        onRowClick={(p) => setFocus(p.id)}
        toolbar={
          <FilterBar onReset={list.reset} filtered={!!list.debouncedSearch || (!cooperativeId && !!list.filters.cooperative_id)}>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search cooperative, or paste a full M-Pesa code" label="Search payments" />
            {!cooperativeId && <FilterSelect label="Cooperative" value={list.filters.cooperative_id} onChange={(v) => list.setFilter('cooperative_id', v)} allLabel="All cooperatives" options={coops} />}
            {s && <span className="ml-auto text-sm text-[#5E6B64]">Verified to date: <strong className="tabular-nums text-[#17221D]">{formatKes(s.verified.amount_kes)}</strong></span>}
          </FilterBar>
        }
        empty={<EmptyState icon={<CreditCard className="size-8" />} title={tab === 'PENDING' ? 'Nothing waiting for verification' : 'No payments here'} />}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={data.data?.total ?? 0} onPage={list.setPage} />}
      />
      {focus && <PaymentPanel id={focus} onClose={() => setFocus(null)} onDecided={() => void data.reload()} />}
    </>
  );
}

function PaymentPanel({ id, onClose, onDecided }: { id: string; onClose: () => void; onDecided: () => void }) {
  const toast = useToast();
  const { refresh } = useSuperadminData();
  const payment = useResource(() => getPayment(id), [id]);
  const [deciding, setDeciding] = useState<'VERIFY' | 'REJECT' | null>(null);
  const [matched, setMatched] = useState(false);
  const p = payment.data;

  return (
    <DetailPanel
      title={p ? formatKes(p.amount_kes) : 'Payment'}
      subtitle={p?.cooperative_name ?? undefined}
      badge={p && <StatusBadge status={p.status} />}
      onClose={onClose}
      actions={
        p?.status === 'PENDING' && (
          <>
            <button onClick={() => setDeciding('REJECT')} className={dangerButton}>Reject…</button>
            <button onClick={() => setDeciding('VERIFY')} disabled={!matched} className={primaryButton}>Verify and issue credits</button>
          </>
        )
      }
    >
      {payment.error && <ErrorBanner message={payment.error} onRetry={payment.reload} />}
      {!p && !payment.error && <LoadingState rows={4} />}
      {p && (
        <>
          <DetailSection title="Payment">
            <DetailList>
              <DetailRow label="Cooperative" value={p.cooperative_id ? <Link className="text-[#176044] hover:underline" href={`/superadmin/cooperatives/${p.cooperative_id}`}>{p.cooperative_name}</Link> : 'Unknown'} />
              <DetailRow label="Amount paid" value={<span className="font-semibold tabular-nums">{formatKes(p.amount_kes)}</span>} />
              <DetailRow label="Credits" value={formatNumber(p.credits_requested)} />
              <DetailRow label="Package" value={p.package_name ?? 'Custom amount'} />
              <DetailRow label="M-Pesa code" value={<code className="rounded bg-[#EEF1EC] px-1.5 py-0.5 text-[13px]">{p.masked_mpesa_ref}</code>} />
              <DetailRow label="Submitted" value={formatDateTime(p.submitted_at)} />
              {p.verified_at && <DetailRow label="Decided" value={formatDateTime(p.verified_at)} />}
              {p.rejection_reason && <DetailRow label="Rejected because" value={p.rejection_reason} />}
            </DetailList>
          </DetailSection>
          {p.status === 'PENDING' && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#DDE3DE] p-3 text-sm">
              <input type="checkbox" checked={matched} onChange={(e) => setMatched(e.target.checked)} className="mt-0.5 size-4 accent-[#176044]" />
              <span>
                I found this M-Pesa code and amount in the paybill statement.
                <span className="block text-xs text-[#5E6B64]">Verifying adds the credits to the cooperative&apos;s balance immediately.</span>
              </span>
            </label>
          )}
          <DetailSection title="History">
            <AuditTrail entries={p.activity} />
          </DetailSection>
        </>
      )}
      {p && deciding && (
        <ConfirmationDialog
          title={deciding === 'VERIFY' ? 'Issue the credits?' : 'Reject this payment?'}
          body={
            deciding === 'VERIFY'
              ? `${formatNumber(p.credits_requested)} credits will be added to ${p.cooperative_name ?? 'the cooperative'}. This can't be undone, only corrected with a manual adjustment.`
              : 'The cooperative will see it as rejected with your reason.'
          }
          confirmLabel={deciding === 'VERIFY' ? 'Verify and issue credits' : 'Reject payment'}
          danger={deciding === 'REJECT'}
          reason={deciding === 'REJECT' ? { label: 'Reason', required: true, placeholder: 'e.g. Code not found in the paybill statement' } : undefined}
          onClose={() => setDeciding(null)}
          onConfirm={async (reason) => {
            await verifyPayment(p.id, deciding, reason || undefined);
            toast(deciding === 'VERIFY' ? 'Credits issued.' : 'Payment rejected.');
            setDeciding(null);
            await payment.reload();
            onDecided();
            void refresh();
          }}
        />
      )}
    </DetailPanel>
  );
}
