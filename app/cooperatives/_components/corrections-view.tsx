'use client';

// Corrections and reversals awaiting review. Maker-checker: the person who asked can't approve or reject;
// they can only withdraw. Approving never edits the original collection: a correction creates a new version
// that supersedes it, a reversal voids it, and both stay in the history.
import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import {
  ConfirmationDialog, DataTable, EmptyState, FilterBar, FilterSelect, Modal, PageHeader, Pagination, StatusBadge,
  dangerButton, primaryButton, secondaryButton, type Column,
} from '@/components/admin';
import { useToast } from '@/app/superadmin/_components/toast';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useListState } from '@/lib/hooks/use-list-state';
import { useResource } from '@/lib/hooks/use-resource';
import {
  approveRequest, cancelRequest, listRequests, rejectRequest, type CorrectionRequest,
} from '@/lib/collections/batch-client';

type Allocation = { farmer_id: string; quantity_kg: number };

export function CorrectionsView() {
  const toast = useToast();
  const list = useListState({ filters: { status: 'PENDING', type: '' } });
  const data = useResource(() => listRequests(list.params), [JSON.stringify(list.params)]);
  const [open, setOpen] = useState<CorrectionRequest | null>(null);
  const [decision, setDecision] = useState<{ request: CorrectionRequest; action: 'approve' | 'reject' | 'cancel' } | null>(null);
  const me = data.data?.user_id;

  const canReview = (r: CorrectionRequest) =>
    r.status === 'PENDING' && r.requested_by !== me &&
    (r.request_type === 'CORRECTION' ? data.data?.can_approve_corrections : data.data?.can_approve_reversals);

  const columns: Column<CorrectionRequest>[] = [
    { key: 'when', header: 'Requested', cell: (r) => formatDateTime(r.created_at) },
    { key: 'batch', header: 'Collection', cell: (r) => <span className="font-mono text-xs">{r.batch_reference}</span> },
    { key: 'type', header: 'Type', cell: (r) => <StatusBadge status={r.request_type} tone={r.request_type === 'REVERSAL' ? 'red' : 'blue'} /> },
    { key: 'by', header: 'By', cell: (r) => r.requested_by_name ?? '–' },
    { key: 'reason', header: 'Reason', cell: (r) => <span className="line-clamp-2">{r.reason}</span> },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Corrections & reversals"
        subtitle="Confirmed collections are never edited. Changes are requested, then approved by a different person."
        badge={data.data?.pending ? <StatusBadge status="PENDING" label={`${data.data.pending} pending`} /> : undefined}
      />
      <DataTable
        columns={columns}
        rows={data.data?.items}
        rowKey={(r) => r.id}
        loading={data.loading}
        error={data.error}
        onRetry={data.reload}
        onRowClick={setOpen}
        mobileCards
        toolbar={
          <FilterBar onReset={list.reset} filtered={list.isFiltered}>
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} allLabel="Any status"
              options={['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))} />
            <FilterSelect label="Type" value={list.filters.type} onChange={(v) => list.setFilter('type', v)} allLabel="Corrections and reversals"
              options={[{ value: 'CORRECTION', label: 'Corrections' }, { value: 'REVERSAL', label: 'Reversals' }]} />
          </FilterBar>
        }
        empty={<EmptyState icon={<ClipboardCheck className="size-8" />} title="Nothing waiting for review" />}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={data.data?.total ?? 0} onPage={list.setPage} />}
      />

      {open && (
        <Modal title={`${open.request_type === 'CORRECTION' ? 'Correction' : 'Reversal'} of ${open.batch_reference}`} onClose={() => setOpen(null)} wide>
          <RequestDetail request={open} />
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {open.status === 'PENDING' && open.requested_by === me && (
              <button className={secondaryButton} onClick={() => setDecision({ request: open, action: 'cancel' })}>Withdraw my request</button>
            )}
            {canReview(open) && (
              <>
                <button className={dangerButton} onClick={() => setDecision({ request: open, action: 'reject' })}>Reject</button>
                <button className={primaryButton} onClick={() => setDecision({ request: open, action: 'approve' })}>Approve</button>
              </>
            )}
          </div>
          {open.status === 'PENDING' && open.requested_by === me && (
            <p className="mt-3 text-xs text-[#5E6B64]">You made this request, so someone else must review it.</p>
          )}
        </Modal>
      )}

      {decision && (
        <ConfirmationDialog
          title={decision.action === 'approve' ? 'Approve this request?' : decision.action === 'reject' ? 'Reject this request?' : 'Withdraw this request?'}
          body={
            decision.action === 'approve'
              ? decision.request.request_type === 'CORRECTION'
                ? 'A corrected version of the collection is created; the original stays in the history as corrected. Paid milk is adjusted on the farmer’s next payment.'
                : 'The collection is reversed: it stays in the history but no longer counts. Paid milk is recovered on the farmer’s next payment.'
              : decision.action === 'reject'
                ? 'The collection stays exactly as recorded.'
                : 'The collection stays exactly as recorded.'
          }
          confirmLabel={decision.action === 'approve' ? 'Approve' : decision.action === 'reject' ? 'Reject' : 'Withdraw'}
          danger={decision.action !== 'approve'}
          reason={decision.action === 'cancel' ? undefined : { label: 'Comment', required: decision.action === 'reject', minLength: 3 }}
          onClose={() => setDecision(null)}
          onConfirm={async (comment) => {
            const { request, action } = decision;
            if (action === 'approve') await approveRequest(request.id, comment);
            else if (action === 'reject') await rejectRequest(request.id, comment);
            else await cancelRequest(request.id);
            setDecision(null);
            setOpen(null);
            toast(action === 'approve' ? 'Approved.' : action === 'reject' ? 'Rejected.' : 'Withdrawn.');
            void data.reload();
          }}
        />
      )}
    </>
  );
}

export function RequestDetail({ request: r }: { request: CorrectionRequest }) {
  const original = r.original_values as { captured_weight_kg?: number; allocations?: Allocation[]; collection_date?: string };
  const proposed = (r.proposed_values ?? {}) as { captured_weight_kg?: number; allocations?: Allocation[] };
  const farmerIds = [...new Set([...(original.allocations ?? []), ...(proposed.allocations ?? [])].map((a) => a.farmer_id))];
  const kgOf = (list: Allocation[] | undefined, id: string) => list?.find((a) => a.farmer_id === id)?.quantity_kg;
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="text-[#5E6B64]">Requested by</dt><dd className="font-medium">{r.requested_by_name ?? '–'} ({r.requested_role})</dd></div>
        <div><dt className="text-[#5E6B64]">Status</dt><dd><StatusBadge status={r.status} /></dd></div>
        <div className="col-span-2"><dt className="text-[#5E6B64]">Reason</dt><dd>{r.reason}</dd></div>
        {r.reviewed_by_name && <div className="col-span-2"><dt className="text-[#5E6B64]">Reviewed by</dt><dd>{r.reviewed_by_name}, {formatDateTime(r.reviewed_at)}{r.review_comment ? `: ${r.review_comment}` : ''}</dd></div>}
        {r.resulting_batch_reference && <div className="col-span-2"><dt className="text-[#5E6B64]">Corrected version</dt><dd className="font-mono">{r.resulting_batch_reference}</dd></div>}
      </dl>
      {r.request_type === 'CORRECTION' ? (
        <div className="overflow-x-auto rounded-lg border border-[#EEF1EC]">
          <table className="w-full min-w-[420px] text-left">
            <caption className="sr-only">Recorded versus proposed values</caption>
            <thead className="text-xs uppercase text-[#8A968F]"><tr><th className="px-3 py-2"> </th><th className="px-3 py-2 text-right">Recorded</th><th className="px-3 py-2 text-right">Proposed</th></tr></thead>
            <tbody className="divide-y divide-[#EEF1EC]">
              <tr><th scope="row" className="px-3 py-2 font-medium">Total KG</th><td className="px-3 py-2 text-right tabular-nums">{formatNumber(original.captured_weight_kg)}</td><td className="px-3 py-2 text-right tabular-nums">{formatNumber(proposed.captured_weight_kg)}</td></tr>
              {farmerIds.map((id) => {
                const before = kgOf(original.allocations, id);
                const after = kgOf(proposed.allocations, id);
                return (
                  <tr key={id} className={before !== after ? 'bg-[#FBF1DC]' : ''}>
                    <th scope="row" className="px-3 py-2 font-normal">{r.farmer_names?.[id] ?? `${id.slice(0, 8)}…`}</th>
                    <td className="px-3 py-2 text-right tabular-nums">{before ?? '–'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{after ?? 'removed'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg bg-[#FDECEA] px-3 py-2 text-[#912018]">Reversal: {formatNumber(original.captured_weight_kg)} KG from {original.collection_date} would stop counting.</p>
      )}
    </div>
  );
}
