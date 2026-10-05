'use client';

// SMS Credit Center. Every figure comes from the server's credit ledger; credits are added only when the
// platform team VERIFIES an M-Pesa payment against the statement (nothing is credited on submission).
import { useState } from 'react';
import { CircleDollarSign, MessageSquareText, RefreshCw } from 'lucide-react';
import {
  ConfirmationDialog, DataTable, EmptyState, ErrorState, Field, FormDialog, Pagination, PageHeader, StatCard, StatusBadge,
  inputClass, primaryButton, secondaryButton, type Column,
} from '@/components/admin';
import { useToast } from '@/app/superadmin/_components/toast';
import { formatDateTime, formatKes, formatNumber, humanize } from '@/lib/format';
import { useResource } from '@/lib/hooks/use-resource';
import { useSubmit } from '@/lib/hooks/use-submit';
import {
  buyCredits, cancelCreditPayment, getCreditCenter, listSmsMessages, retrySms, updateSmsSettings,
  type CreditTransaction, type SmsMessage, type SmsPayment,
} from '../_api/finance-client';
import { MobileCards } from './mobile-cards';

const TXN_TONE: Record<string, 'green' | 'amber' | 'grey' | 'blue' | 'red'> = {
  PURCHASE: 'green', ADJUSTMENT: 'blue', RESERVED: 'amber', CONSUMED: 'grey', REFUNDED: 'green', EXPIRY: 'red',
};
const SMS_TONE: Record<string, 'green' | 'amber' | 'grey' | 'blue' | 'red'> = {
  SENT: 'green', PENDING: 'amber', PENDING_PROVIDER: 'amber', RESERVED: 'blue', SENDING: 'blue', FAILED: 'red', REFUNDED: 'red', SKIPPED: 'grey',
};

export function SmsCreditCenter() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const center = useResource(() => getCreditCenter({ page, page_size: 15 }), [page]);
  const [msgPage, setMsgPage] = useState(1);
  const messages = useResource(() => listSmsMessages({ page: msgPage, page_size: 10 }), [msgPage]);
  const [buying, setBuying] = useState(false);
  const [cancelling, setCancelling] = useState<SmsPayment | null>(null);
  const c = center.data;

  if (center.error && !c) return <ErrorState message={center.error} onRetry={center.reload} />;

  const txnColumns: Column<CreditTransaction>[] = [
    { key: 'when', header: 'When', cell: (t) => formatDateTime(t.created_at) },
    { key: 'type', header: 'Type', cell: (t) => <StatusBadge status={t.transaction_type} tone={TXN_TONE[t.transaction_type]} /> },
    { key: 'amount', header: 'Credits', align: 'right', cell: (t) => <span className="tabular-nums">{t.amount > 0 ? '+' : ''}{formatNumber(t.amount)}</span> },
    { key: 'ref', header: 'Reference', cell: (t) => <span className="font-mono text-xs">{t.reference}</span> },
    { key: 'reason', header: 'Reason', cell: (t) => t.reason ?? '–' },
  ];
  const msgColumns: Column<SmsMessage>[] = [
    { key: 'when', header: 'Created', cell: (m) => formatDateTime(m.created_at) },
    { key: 'type', header: 'Type', cell: (m) => humanize(m.type) },
    { key: 'to', header: 'To', cell: (m) => <span className="font-mono text-xs">{m.recipient_phone}</span> },
    { key: 'status', header: 'Status', cell: (m) => <span title={m.error ?? undefined}><StatusBadge status={m.status} tone={SMS_TONE[m.status]} label={m.status === 'SENT' ? 'Sent (provider accepted)' : humanize(m.status)} /></span> },
    {
      key: 'act', header: '', align: 'right',
      cell: (m) => ['FAILED', 'REFUNDED', 'PENDING_PROVIDER'].includes(m.status) ? (
        <button
          className={secondaryButton}
          onClick={async () => {
            try {
              const r = await retrySms(m.id);
              toast(r.status === 'SENT' ? 'SMS sent.' : `Not sent: ${r.error ?? humanize(r.status)}`, r.status === 'SENT' ? 'success' : 'error');
              void messages.reload();
              void center.reload();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Retry failed.', 'error');
            }
          }}
        >
          <RefreshCw aria-hidden className="size-4" /> Retry
        </button>
      ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="SMS Credit Center"
        subtitle="Credits for collection receipts and cooler alerts. Balances are calculated from the credit ledger."
        action={c?.can_purchase && <button className={primaryButton} onClick={() => setBuying(true)}><CircleDollarSign aria-hidden className="size-4" /> Buy SMS credits</button>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Available" value={c ? formatNumber(c.balances.available) : '–'} />
        <StatCard label="Reserved (sending)" value={c ? formatNumber(c.balances.reserved) : '–'} />
        <StatCard label="Consumed" value={c ? formatNumber(c.balances.consumed) : '–'} />
        <StatCard label="Refunded" value={c ? formatNumber(c.balances.refunded) : '–'} />
        <StatCard label="Current balance" value={c ? formatNumber(c.balances.balance) : '–'} />
      </div>

      {c && (
        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-[#DDE3DE] bg-white p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold"><MessageSquareText aria-hidden className="size-4" /> Delivery health (30 days)</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-[#5E6B64]">Sent (provider accepted)</dt><dd className="text-lg font-semibold tabular-nums">{formatNumber(c.health.sent)}</dd></div>
              <div><dt className="text-[#5E6B64]">Failed</dt><dd className="text-lg font-semibold tabular-nums">{formatNumber(c.health.failed)}</dd></div>
              <div><dt className="text-[#5E6B64]">Waiting</dt><dd className="text-lg font-semibold tabular-nums">{formatNumber(c.health.waiting)}</dd></div>
              <div><dt className="text-[#5E6B64]">Success rate</dt><dd className="text-lg font-semibold tabular-nums">{c.health.success_rate == null ? '–' : `${c.health.success_rate}%`}</dd></div>
            </dl>
            {c.health.pending_provider > 0 && (
              <p className="mt-3 rounded-lg bg-[#FBF1DC] px-3 py-2 text-sm text-[#5C3D06]">
                {formatNumber(c.health.pending_provider)} SMS are waiting because no SMS provider is configured on the server. They have not been sent.
              </p>
            )}
          </div>
          <div className="rounded-xl border border-[#DDE3DE] bg-white p-5">
            <h2 className="text-base font-semibold">SMS settings</h2>
            {[
              ['receipt_sms_enabled', 'Collection receipts to farmers', 'One credit per farmer per confirmed collection.'] as const,
              ['alert_sms_enabled', 'Cooler alerts by SMS', 'To admins and the cooler’s manager.'] as const,
            ].map(([key, label, help]) => (
              <label key={key} className="mt-3 flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[#176044]"
                  checked={c.settings[key]}
                  disabled={!c.can_purchase}
                  onChange={async (e) => {
                    try {
                      await updateSmsSettings({ [key]: e.target.checked });
                      void center.reload();
                    } catch (err) {
                      toast(err instanceof Error ? err.message : 'Could not save.', 'error');
                    }
                  }}
                />
                <span><span className="block text-sm font-medium">{label}</span><span className="text-xs text-[#5E6B64]">{help}</span></span>
              </label>
            ))}
          </div>
        </section>
      )}

      <h2 className="mb-3 mt-8 text-base font-semibold">Credit purchases</h2>
      {c && c.payments.length === 0 ? (
        <EmptyState title="No purchases yet" body={c.can_purchase ? 'Use “Buy SMS credits” after paying by M-Pesa.' : undefined} />
      ) : (
        <MobileCards
          rows={c?.payments}
          rowKey={(p) => p.id}
          loading={center.loading}
          columns={[
            { key: 'when', header: 'Submitted', cell: (p) => formatDateTime(p.submitted_at) },
            { key: 'credits', header: 'Credits', align: 'right', cell: (p) => formatNumber(p.credits_requested) },
            { key: 'amount', header: 'Amount', align: 'right', cell: (p) => formatKes(p.amount_kes) },
            { key: 'ref', header: 'M-Pesa', cell: (p) => <span className="font-mono text-xs">{p.masked_mpesa_ref}</span> },
            { key: 'status', header: 'Status', cell: (p) => <span title={p.rejection_reason ?? undefined}><StatusBadge status={p.status} /></span> },
            {
              key: 'act', header: '', align: 'right',
              cell: (p) => p.status === 'PENDING' && c?.can_purchase ? <button className={secondaryButton} onClick={() => setCancelling(p)}>Cancel</button> : null,
            },
          ]}
        />
      )}

      <h2 className="mb-3 mt-8 text-base font-semibold">Ledger</h2>
      <DataTable
        columns={txnColumns}
        rows={c?.transactions.items}
        rowKey={(t) => t.id}
        loading={center.loading}
        minWidth="640px"
        empty={<EmptyState title="No ledger entries yet" />}
        footer={<Pagination page={page} pageSize={15} total={c?.transactions.total ?? 0} onPage={setPage} />}
      />

      <h2 className="mb-3 mt-8 text-base font-semibold">Recent SMS</h2>
      <DataTable
        columns={msgColumns}
        rows={messages.data?.items}
        rowKey={(m) => m.id}
        loading={messages.loading}
        error={messages.error}
        onRetry={messages.reload}
        minWidth="680px"
        empty={<EmptyState title="No SMS yet" />}
        footer={<Pagination page={msgPage} pageSize={10} total={messages.data?.total ?? 0} onPage={setMsgPage} />}
      />

      {buying && c && (
        <BuyDialog
          packages={c.packages}
          instructions={c.payment_instructions}
          onClose={() => setBuying(false)}
          onDone={() => {
            setBuying(false);
            toast('Payment submitted. Credits are added once the platform team verifies it.');
            void center.reload();
          }}
        />
      )}
      {cancelling && (
        <ConfirmationDialog
          title="Cancel this payment?"
          body={`The submitted payment ${cancelling.masked_mpesa_ref} will be withdrawn and never credited.`}
          confirmLabel="Cancel payment"
          danger
          reason={{ label: 'Why?', required: true, minLength: 5 }}
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            await cancelCreditPayment(cancelling.id, reason);
            setCancelling(null);
            toast('Payment cancelled.');
            void center.reload();
          }}
        />
      )}
    </>
  );
}

function BuyDialog({
  packages,
  instructions,
  onClose,
  onDone,
}: {
  packages: { id: string; name: string; credits_amount: number; price_kes: number }[];
  instructions: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [packageId, setPackageId] = useState(packages[0]?.id ?? '');
  const [credits, setCredits] = useState('');
  const [amount, setAmount] = useState('');
  const [code, setCode] = useState('');
  return (
    <FormDialog
      title="Buy SMS credits"
      onClose={onClose}
      busy={busy}
      error={formError}
      submitLabel="Submit payment for verification"
      onSubmit={async () => {
        const ok = await run(async () => {
          await buyCredits(packageId ? { package_id: packageId, mpesa_reference: code } : { credits: Number(credits), amount_kes: Number(amount), mpesa_reference: code });
        });
        if (ok) onDone();
      }}
    >
      <p className="mb-4 rounded-lg bg-[#F6F7F4] px-3 py-2 text-sm text-[#3C4A43]">{instructions}</p>
      <div className="space-y-4">
        <Field label="Package" error={fieldErrors.package_id}>
          {(p) => (
            <select {...p} className={inputClass} value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              {packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name}: {formatNumber(pkg.credits_amount)} credits for {formatKes(pkg.price_kes)}</option>)}
              <option value="">Custom amount</option>
            </select>
          )}
        </Field>
        {!packageId && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Credits" required error={fieldErrors.credits}>{(p) => <input {...p} inputMode="numeric" className={inputClass} value={credits} onChange={(e) => setCredits(e.target.value)} />}</Field>
            <Field label="Amount paid (KES)" required error={fieldErrors.amount_kes}>{(p) => <input {...p} inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          </div>
        )}
        <Field label="M-Pesa confirmation code" required error={fieldErrors.mpesa_reference} hint="e.g. SJK3H2L9QX, from the M-Pesa SMS">
          {(p) => <input {...p} className={`${inputClass} font-mono uppercase`} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />}
        </Field>
        <p className="text-xs text-[#5E6B64]">Status after submitting: <strong>Pending</strong> until verified. Rejected or cancelled payments add no credits.</p>
      </div>
    </FormDialog>
  );
}
