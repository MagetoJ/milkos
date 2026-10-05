'use client';

// One collection batch for office staff: its lines, SMS receipts, history of correction / reversal requests,
// and the forms to request a change. Confirmed collections are never edited here; requests are reviewed by
// someone else in Corrections.
import { useState } from 'react';
import { ErrorBanner, Field, Modal, StatusBadge, inputClass, primaryButton, secondaryButton } from '@/components/admin';
import { ApiError } from '@/lib/api-client';
import { formatKg, parseKg } from '@/lib/collections/allocation';
import { getBatch, requestCorrection, requestReversal, type BatchDetail } from '@/lib/collections/batch-client';
import { receiptLabel } from '@/lib/collections/receipts';
import { formatDateTime } from '@/lib/format';
import { useResource } from '@/lib/hooks/use-resource';

const WEIGHT_SOURCE: Record<string, string> = {
  SCALE: 'Scale', MANUAL: 'Manual entry', SIMULATED: 'Scale simulator', LITRES: 'Entered in litres (KG derived)',
};

export function BatchDetailDialog({ batchId, onClose, onChanged }: { batchId: string; onClose: () => void; onChanged: () => void }) {
  const batch = useResource(() => getBatch(batchId) as Promise<BatchDetail | null>, [batchId]);
  const [mode, setMode] = useState<'none' | 'correct' | 'reverse'>('none');
  const b = batch.data;
  return (
    <Modal title={b ? `Collection ${b.reference}` : 'Collection'} onClose={onClose} wide>
      {batch.error && <ErrorBanner message={batch.error} onRetry={batch.reload} />}
      {!b && !batch.error && <p role="status">Loading…</p>}
      {b && (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div><dt className="text-[#5E6B64]">Status</dt><dd><StatusBadge status={b.status} /></dd></div>
            <div><dt className="text-[#5E6B64]">Date</dt><dd>{b.collection_date} {b.collection_time}</dd></div>
            <div><dt className="text-[#5E6B64]">Cooler</dt><dd>{b.cooler_name ?? '–'}</dd></div>
            <div><dt className="text-[#5E6B64]">Collector</dt><dd>{b.collector_name ?? 'Office staff'}</dd></div>
            <div><dt className="text-[#5E6B64]">Weight</dt><dd>{formatKg(b.captured_weight_kg)} · {WEIGHT_SOURCE[b.weight_source] ?? b.weight_source}{b.scale_name ? ` (${b.scale_name})` : ''}</dd></div>
            <div><dt className="text-[#5E6B64]">Unallocated</dt><dd>{formatKg(b.remaining_weight_kg)}</dd></div>
          </dl>
          <div className="overflow-x-auto rounded-lg border border-[#EEF1EC]">
            <table className="w-full min-w-[520px] text-left">
              <caption className="sr-only">Farmers in this collection</caption>
              <thead className="text-xs uppercase text-[#8A968F]">
                <tr><th className="px-3 py-2">Farmer</th><th className="px-3 py-2 text-right">KG</th><th className="px-3 py-2">Quality</th><th className="px-3 py-2">Record</th><th className="px-3 py-2">SMS receipt</th></tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1EC]">
                {b.lines.map((l) => {
                  const r = receiptLabel(l.receipt_status, 'synced', b.send_receipts);
                  return (
                    <tr key={l.id}>
                      <td className="px-3 py-2">{l.farmer_name} <span className="text-xs text-[#8A968F]">{l.farmer_number}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.quantity_kg}</td>
                      <td className="px-3 py-2"><StatusBadge status={l.quality_status ?? 'ACCEPTED'} /></td>
                      <td className="px-3 py-2"><StatusBadge status={l.record_status ?? 'ACTIVE'} /></td>
                      <td className="px-3 py-2" title={r.detail}><StatusBadge status={r.label} label={r.label} tone={r.tone} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {b.requests?.length > 0 && (
            <div>
              <h3 className="mb-2 font-semibold">Requests</h3>
              <ul className="space-y-2">
                {b.requests.map((r) => (
                  <li key={r.id} className="rounded-lg border border-[#EEF1EC] p-3">
                    <p><StatusBadge status={r.request_type} tone={r.request_type === 'REVERSAL' ? 'red' : 'blue'} /> <StatusBadge status={r.status} /> {formatDateTime(r.created_at)} · {r.requested_by_name}</p>
                    <p className="mt-1">{r.reason}</p>
                    {r.review_comment && <p className="text-xs text-[#5E6B64]">Review: {r.review_comment}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {mode === 'none' && (b.can_request_correction || b.can_request_reversal) && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-[#EEF1EC] pt-4">
              {b.can_request_reversal && <button className={secondaryButton} onClick={() => setMode('reverse')}>Request reversal</button>}
              {b.can_request_correction && <button className={primaryButton} onClick={() => setMode('correct')}>Request correction</button>}
            </div>
          )}
          {mode !== 'none' && (
            <ChangeForm
              batch={b}
              mode={mode}
              onCancel={() => setMode('none')}
              onDone={() => {
                setMode('none');
                void batch.reload();
                onChanged();
              }}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

function ChangeForm({ batch, mode, onCancel, onDone }: { batch: BatchDetail; mode: 'correct' | 'reverse'; onCancel: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [total, setTotal] = useState(String(batch.captured_weight_kg));
  const [amounts, setAmounts] = useState<Record<string, string>>(Object.fromEntries(batch.lines.map((l) => [l.farmer_id, String(l.quantity_kg)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3 border-t border-[#EEF1EC] pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          if (mode === 'reverse') await requestReversal(batch.id, reason.trim());
          else {
            await requestCorrection(batch.id, reason.trim(), {
              captured_weight_kg: Number(total),
              allocations: batch.lines
                .map((l) => ({ farmer_id: l.farmer_id, quantity_kg: parseKg(amounts[l.farmer_id]) ?? 0 }))
                .filter((a) => a.quantity_kg > 0),
            });
          }
          onDone();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Could not send the request.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="font-semibold">{mode === 'reverse' ? 'Request a reversal' : 'Request a correction'}</h3>
      {mode === 'correct' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Total weight (KG)" required>{(p) => <input {...p} inputMode="decimal" className={inputClass} value={total} onChange={(e) => setTotal(e.target.value)} />}</Field>
          {batch.lines.map((l) => (
            <Field key={l.farmer_id} label={`${l.farmer_name} (KG, 0 removes)`}>
              {(p) => <input {...p} inputMode="decimal" className={inputClass} value={amounts[l.farmer_id] ?? ''} onChange={(e) => setAmounts({ ...amounts, [l.farmer_id]: e.target.value })} />}
            </Field>
          ))}
        </div>
      )}
      <Field label="Reason" required hint="Recorded in the audit trail and shown to the reviewer.">
        {(p) => <textarea {...p} rows={2} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      {error && <ErrorBanner message={error} />}
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryButton} onClick={onCancel}>Cancel</button>
        <button type="submit" className={primaryButton} disabled={busy || reason.trim().length < 5}>{busy ? 'Sending…' : 'Send for review'}</button>
      </div>
    </form>
  );
}
