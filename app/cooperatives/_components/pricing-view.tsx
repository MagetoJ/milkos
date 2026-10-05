'use client';

// Milk prices per KG. Prices are never edited: a new price starts on a date (closing the previous open-ended
// one the day before), and a price that farmer payments used can't be cancelled.
import { useState } from 'react';
import { Plus, Tags } from 'lucide-react';
import {
  ConfirmationDialog, EmptyState, ErrorState, Field, FormDialog, PageHeader, StatCard, StatusBadge,
  inputClass, primaryButton, secondaryButton,
} from '@/components/admin';
import { useToast } from '@/app/superadmin/_components/toast';
import { formatDate, formatDateTime, formatKes, isoDay } from '@/lib/format';
import { useResource } from '@/lib/hooks/use-resource';
import { useSubmit } from '@/lib/hooks/use-submit';
import { cancelPrice, createPrice, listPrices, type MilkPrice } from '../_api/finance-client';
import { MobileCards } from './mobile-cards';

const perKg = (n: number) => `${formatKes(n)}/KG`;

export function PricingView() {
  const toast = useToast();
  const prices = useResource(listPrices, []);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<MilkPrice | null>(null);
  const d = prices.data;
  if (prices.error && !d) return <ErrorState message={prices.error} onRetry={prices.reload} />;

  return (
    <>
      <PageHeader
        title="Milk pricing"
        subtitle="The price paid to farmers per KG, by date. Each farmer payment keeps the price it used."
        action={d?.can_manage && <button className={primaryButton} onClick={() => setAdding(true)}><Plus aria-hidden className="size-4" /> New price</button>}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Current price" value={d?.current ? perKg(d.current.price_per_kg) : 'Not set'} />
        <StatCard label="Effective since" value={d?.current ? formatDate(d.current.effective_from) : '–'} />
        <StatCard label="Until" value={d?.current ? (d.current.effective_to ? formatDate(d.current.effective_to) : 'Next price') : '–'} />
      </div>
      {d && d.items.length === 0 ? (
        <EmptyState icon={<Tags className="size-8" />} title="No milk price yet" body="Farmer payments can't be calculated until a price covers the collection dates." />
      ) : (
        <MobileCards
          rows={d?.items}
          rowKey={(p) => p.id}
          loading={prices.loading}
          columns={[
            { key: 'price', header: 'Price', cell: (p) => <span className="font-semibold">{perKg(p.price_per_kg)}</span> },
            { key: 'from', header: 'From', cell: (p) => formatDate(p.effective_from) },
            { key: 'to', header: 'To', cell: (p) => (p.effective_to ? formatDate(p.effective_to) : 'Open') },
            { key: 'status', header: 'Status', cell: (p) => <span title={p.cancel_reason ?? undefined}><StatusBadge status={p.status} /></span> },
            { key: 'used', header: 'Used by payments', cell: (p) => (p.used_by_payments ? 'Yes (locked)' : 'No') },
            { key: 'set', header: 'Set', cell: (p) => formatDateTime(p.created_at) },
            {
              key: 'act', header: '', align: 'right',
              cell: (p) => d?.can_manage && p.status === 'ACTIVE' && !p.used_by_payments
                ? <button className={secondaryButton} onClick={() => setCancelling(p)}>Cancel</button> : null,
            },
          ]}
        />
      )}
      {adding && (
        <PriceDialog
          onClose={() => setAdding(false)}
          onDone={(p) => {
            setAdding(false);
            toast(`Price ${perKg(p.price_per_kg)} from ${formatDate(p.effective_from)} saved.`);
            void prices.reload();
          }}
        />
      )}
      {cancelling && (
        <ConfirmationDialog
          title="Cancel this price?"
          body={`${perKg(cancelling.price_per_kg)} from ${formatDate(cancelling.effective_from)} will stop applying. The change is recorded in the audit trail.`}
          confirmLabel="Cancel price"
          danger
          reason={{ label: 'Reason', required: true, minLength: 5 }}
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            await cancelPrice(cancelling.id, reason);
            setCancelling(null);
            toast('Price cancelled.');
            void prices.reload();
          }}
        />
      )}
    </>
  );
}

function PriceDialog({ onClose, onDone }: { onClose: () => void; onDone: (p: MilkPrice) => void }) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [f, setF] = useState({ effective_from: isoDay(), effective_to: '', price_per_kg: '', notes: '' });
  return (
    <FormDialog
      title="New milk price"
      onClose={onClose}
      busy={busy}
      error={formError}
      submitLabel="Save price"
      onSubmit={async () => {
        let saved: MilkPrice | undefined;
        const ok = await run(async () => {
          saved = await createPrice({
            effective_from: f.effective_from, effective_to: f.effective_to || null,
            price_per_kg: Number(f.price_per_kg), notes: f.notes || null,
          });
        });
        if (ok && saved) onDone(saved);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Price per KG (KES)" required error={fieldErrors.price_per_kg}>
          {(p) => <input {...p} inputMode="decimal" className={inputClass} value={f.price_per_kg} onChange={(e) => setF({ ...f, price_per_kg: e.target.value })} />}
        </Field>
        <Field label="Effective from" required error={fieldErrors.effective_from}>
          {(p) => <input {...p} type="date" className={inputClass} value={f.effective_from} onChange={(e) => setF({ ...f, effective_from: e.target.value })} />}
        </Field>
        <Field label="Effective to" error={fieldErrors.effective_to} hint="Leave empty: until the next price">
          {(p) => <input {...p} type="date" className={inputClass} value={f.effective_to} onChange={(e) => setF({ ...f, effective_to: e.target.value })} />}
        </Field>
        <Field label="Notes" error={fieldErrors.notes}>
          {(p) => <input {...p} className={inputClass} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}
        </Field>
      </div>
      <p className="mt-3 text-xs text-[#5E6B64]">The previous open-ended price ends the day before this one starts. Dates already included in farmer payments can&apos;t be re-priced.</p>
    </FormDialog>
  );
}
