'use client';

// Farmer payments: calculate a period (accepted milk x the price on each collection's date, plus pending
// adjustments), then record each payment's outcome. MilkOS doesn't move money: a payment becomes PAID only
// when someone records the M-Pesa / bank transaction reference (or a configured payout provider confirms).
import { useState } from 'react';
import { Banknote, Calculator } from 'lucide-react';
import {
  DataTable, EmptyState, Field, FilterBar, FilterSelect, FormDialog, Modal, PageHeader, Pagination, SearchInput, StatCard,
  StatusBadge, inputClass, primaryButton, secondaryButton, type Column,
} from '@/components/admin';
import { useToast } from '@/app/superadmin/_components/toast';
import { formatDate, formatDateTime, formatKes, formatNumber, isoDay } from '@/lib/format';
import { useListState } from '@/lib/hooks/use-list-state';
import { useResource } from '@/lib/hooks/use-resource';
import { useSubmit } from '@/lib/hooks/use-submit';
import {
  generatePayments, getFarmerPayment, listFarmerPayments, previewPayments, setPaymentStatus,
  type FarmerPayment, type FarmerPaymentStatus, type PaymentPreview,
} from '../_api/finance-client';

const TONE: Record<FarmerPaymentStatus, 'amber' | 'blue' | 'green' | 'red' | 'grey'> = {
  PENDING: 'amber', PROCESSING: 'blue', PAID: 'green', FAILED: 'red', CANCELLED: 'grey',
};
const kg = (n: number) => `${formatNumber(n)} KG`;

/** What a person may do next with a payment (mirrors backend PaymentStatus.TRANSITIONS). */
export const NEXT_STATUSES: Record<FarmerPaymentStatus, FarmerPaymentStatus[]> = {
  PENDING: ['PAID', 'PROCESSING', 'CANCELLED'],
  PROCESSING: ['PAID', 'FAILED'],
  FAILED: ['PAID', 'PROCESSING', 'CANCELLED'],
  PAID: [],
  CANCELLED: [],
};

export function PaymentsView() {
  const toast = useToast();
  const list = useListState({ filters: { status: '' } });
  const data = useResource(() => listFarmerPayments(list.params), [JSON.stringify(list.params)]);
  const [generating, setGenerating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const s = data.data?.summary;

  const columns: Column<FarmerPayment>[] = [
    { key: 'farmer', header: 'Farmer', cell: (p) => <span><span className="font-medium">{p.farmer_name}</span> <span className="text-xs text-[#8A968F]">{p.farmer_number}</span></span> },
    { key: 'period', header: 'Period', cell: (p) => `${formatDate(p.period_start)} – ${formatDate(p.period_end)}` },
    { key: 'kg', header: 'Milk', align: 'right', cell: (p) => kg(p.total_kg) },
    { key: 'gross', header: 'Gross', align: 'right', cell: (p) => formatKes(p.gross_amount) },
    { key: 'adj', header: 'Adjustments', align: 'right', cell: (p) => (p.adjustments_amount ? formatKes(p.adjustments_amount) : '–') },
    { key: 'net', header: 'Net', align: 'right', cell: (p) => <span className="font-semibold">{formatKes(p.net_amount)}</span> },
    { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} tone={TONE[p.status]} /> },
    { key: 'ref', header: 'Reference', cell: (p) => <span className="font-mono text-xs">{p.payment_reference ?? p.reference}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Farmer payments"
        subtitle="Accepted milk × the milk price on each collection date. Corrections to paid milk become adjustments on the next payment."
        action={data.data?.can_manage && <button className={primaryButton} onClick={() => setGenerating(true)}><Calculator aria-hidden className="size-4" /> Calculate payments</button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Pending" value={s ? `${s.pending.count} · ${formatKes(s.pending.amount)}` : '–'} />
        <StatCard label="Processing" value={s ? `${s.processing.count} · ${formatKes(s.processing.amount)}` : '–'} />
        <StatCard label="Paid" value={s ? `${s.paid.count} · ${formatKes(s.paid.amount)}` : '–'} />
        <StatCard label="Pending adjustments" value={data.data ? formatNumber(data.data.pending_adjustments) : '–'} />
      </div>
      {data.data && !data.data.payout_provider && (
        <p className="mb-4 rounded-lg border border-[#DDE3DE] bg-white px-4 py-3 text-sm text-[#3C4A43]">
          No payout provider is connected. Pay farmers by M-Pesa or bank as usual, then record each transaction reference here.
        </p>
      )}
      <DataTable
        columns={columns}
        rows={data.data?.items}
        rowKey={(p) => p.id}
        loading={data.loading}
        error={data.error}
        onRetry={data.reload}
        onRowClick={(p) => setOpen(p.id)}
        mobileCards
        toolbar={
          <FilterBar onReset={list.reset} filtered={list.isFiltered}>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Farmer, number or reference" label="Search payments" />
            <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} allLabel="Any status"
              options={(['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'] as const).map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))} />
          </FilterBar>
        }
        empty={<EmptyState icon={<Banknote className="size-8" />} title="No farmer payments yet" body="Set a milk price, then calculate payments for a period." />}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={data.data?.total ?? 0} onPage={list.setPage} />}
      />
      {generating && (
        <GenerateDialog
          onClose={() => setGenerating(false)}
          onDone={(n) => {
            setGenerating(false);
            toast(n ? `${n} payment${n === 1 ? '' : 's'} calculated.` : 'Nothing new to pay for this period.');
            void data.reload();
          }}
        />
      )}
      {open && (
        <PaymentDetail
          id={open}
          canManage={!!data.data?.can_manage}
          onClose={() => setOpen(null)}
          onChanged={() => void data.reload()}
        />
      )}
    </>
  );
}

function GenerateDialog({ onClose, onDone }: { onClose: () => void; onDone: (created: number) => void }) {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const [start, setStart] = useState(isoDay(first));
  const [end, setEnd] = useState(isoDay(today));
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const { busy, fieldErrors, formError, run } = useSubmit();
  return (
    <FormDialog
      title="Calculate farmer payments"
      onClose={onClose}
      busy={busy}
      error={formError}
      submitLabel={preview ? 'Create payments' : 'Preview'}
      onSubmit={async () => {
        if (!preview) {
          await run(async () => setPreview(await previewPayments(start, end)));
          return;
        }
        let created = 0;
        const ok = await run(async () => {
          created = (await generatePayments(start, end)).created.length;
        });
        if (ok) onDone(created);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Period start" required error={fieldErrors.period_start}>
          {(p) => <input {...p} type="date" className={inputClass} value={start} onChange={(e) => (setStart(e.target.value), setPreview(null))} />}
        </Field>
        <Field label="Period end" required error={fieldErrors.period_end}>
          {(p) => <input {...p} type="date" max={isoDay()} className={inputClass} value={end} onChange={(e) => (setEnd(e.target.value), setPreview(null))} />}
        </Field>
      </div>
      {preview && (
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-[#F6F7F4] p-4 text-sm">
          <div><dt className="text-[#5E6B64]">Farmers</dt><dd className="font-semibold">{preview.farmers}</dd></div>
          <div><dt className="text-[#5E6B64]">Milk</dt><dd className="font-semibold">{kg(preview.total_kg)}</dd></div>
          <div><dt className="text-[#5E6B64]">Gross</dt><dd className="font-semibold">{formatKes(preview.gross_amount)}</dd></div>
          <div><dt className="text-[#5E6B64]">Adjustments</dt><dd className="font-semibold">{formatKes(preview.adjustments_amount)}</dd></div>
          <div className="col-span-2"><dt className="text-[#5E6B64]">Net total</dt><dd className="text-lg font-semibold">{formatKes(preview.net_amount)}</dd></div>
          {preview.carried_forward_lines > 0 && (
            <p className="col-span-2 text-xs text-[#5E6B64]">{preview.carried_forward_lines} earlier unpaid collection(s) are included at their own date’s price.</p>
          )}
          {preview.missing_price_dates.length > 0 && (
            <p className="col-span-2 rounded bg-[#FDECEA] px-3 py-2 text-[#912018]">No price applies on {preview.missing_price_dates.slice(0, 5).join(', ')}. Add a price first.</p>
          )}
        </dl>
      )}
    </FormDialog>
  );
}

function PaymentDetail({ id, canManage, onClose, onChanged }: { id: string; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const p = useResource(() => getFarmerPayment(id), [id]);
  const [action, setAction] = useState<FarmerPaymentStatus | null>(null);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const { busy, formError, run } = useSubmit();
  const d = p.data;
  const allowed = NEXT_STATUSES;
  return (
    <Modal title={d ? `Payment ${d.reference}` : 'Payment'} onClose={onClose} wide>
      {!d ? (
        <p role="status">Loading…</p>
      ) : (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <div><dt className="text-[#5E6B64]">Farmer</dt><dd className="font-semibold">{d.farmer_name} ({d.farmer_number})</dd></div>
            <div><dt className="text-[#5E6B64]">Status</dt><dd><StatusBadge status={d.status} tone={TONE[d.status]} /></dd></div>
            <div><dt className="text-[#5E6B64]">Pay to</dt><dd>{d.payment_method ?? 'Not set'} {d.payment_account ?? ''}</dd></div>
            <div><dt className="text-[#5E6B64]">Net amount</dt><dd className="text-lg font-semibold">{formatKes(d.net_amount)}</dd></div>
            {d.payment_reference && <div><dt className="text-[#5E6B64]">Transaction ref.</dt><dd className="font-mono">{d.payment_reference}</dd></div>}
            {d.paid_at && <div><dt className="text-[#5E6B64]">Paid</dt><dd>{formatDateTime(d.paid_at)}</dd></div>}
            {d.failure_reason && <div className="col-span-2"><dt className="text-[#5E6B64]">Reason</dt><dd>{d.failure_reason}</dd></div>}
          </dl>
          <div className="overflow-x-auto rounded-lg border border-[#EEF1EC]">
            <table className="w-full min-w-[480px] text-left">
              <caption className="sr-only">Collections in this payment</caption>
              <thead className="text-xs uppercase text-[#8A968F]"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Collection</th><th className="px-3 py-2 text-right">KG</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
              <tbody className="divide-y divide-[#EEF1EC]">
                {d.lines.map((l) => (
                  <tr key={l.collection_id}>
                    <td className="px-3 py-2">{formatDate(l.collection_date)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{l.collection_reference}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.quantity_kg}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatKes(l.price_per_kg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatKes(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.adjustments.length > 0 && (
            <ul className="space-y-1">
              {d.adjustments.map((a) => <li key={a.id}>{formatKes(a.amount)}: {a.reason}</li>)}
            </ul>
          )}
          {canManage && allowed[d.status].length > 0 && (
            <div className="space-y-3 border-t border-[#EEF1EC] pt-4">
              <div className="flex flex-wrap gap-2">
                {allowed[d.status].map((s) => (
                  <button key={s} className={s === 'PAID' ? primaryButton : secondaryButton} onClick={() => setAction(s)} aria-pressed={action === s}>
                    {s === 'PAID' ? 'Record as paid' : s === 'PROCESSING' ? 'Mark processing' : s === 'FAILED' ? 'Mark failed' : 'Cancel payment'}
                  </button>
                ))}
              </div>
              {action && (
                <div className="space-y-3">
                  {action === 'PAID' && (
                    <Field label="Transaction reference (M-Pesa or bank)" required>
                      {(fp) => <input {...fp} className={`${inputClass} font-mono`} value={reference} onChange={(e) => setReference(e.target.value)} />}
                    </Field>
                  )}
                  {(action === 'FAILED' || action === 'CANCELLED') && (
                    <Field label="Reason" required>{(fp) => <input {...fp} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
                  )}
                  {formError && <p role="alert" className="text-[#B42318]">{formError}</p>}
                  <button
                    className={primaryButton}
                    disabled={busy}
                    onClick={async () => {
                      const ok = await run(async () => {
                        await setPaymentStatus(d.id, { status: action, payment_reference: reference || undefined, reason: reason || undefined });
                      });
                      if (ok) {
                        toast('Payment updated.');
                        setAction(null);
                        void p.reload();
                        onChanged();
                      }
                    }}
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
