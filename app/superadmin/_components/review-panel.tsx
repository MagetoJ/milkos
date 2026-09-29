'use client';

import { useEffect, useRef, useState } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import type { Decision, QueueItem } from '../_types/superadmin-types';
import { formatDateTime, formatKes, formatNumber, waitingFor } from '../_lib/format';
import { useSuperadminData } from './superadmin-data';
import { useToast } from './toast';

const COPY = {
  application: {
    heading: 'Cooperative application',
    approve: 'Approve cooperative',
    reject: 'Reject application',
    approved: (t: string) => `${t} approved.`,
    rejected: (t: string) => `${t}'s application rejected.`,
  },
  payment: {
    heading: 'SMS credit top-up',
    approve: 'Verify and issue credits',
    reject: 'Reject payment',
    approved: (t: string) => `Credits issued to ${t}.`,
    rejected: (t: string) => `Payment from ${t} rejected.`,
  },
} as const;

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-2.5 text-sm">
      <dt className="text-[#5E6B64]">{label}</dt>
      <dd className="break-words text-[#17221D]">{value}</dd>
    </div>
  );
}

export function ReviewPanel({ item, onClose }: { item: QueueItem | null; onClose: () => void }) {
  const { resolve } = useSuperadminData();
  const notify = useToast();
  const [mode, setMode] = useState<'review' | 'rejecting'>('review');
  const [reason, setReason] = useState('');
  const [matched, setMatched] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  // Reset whenever a different item is opened.
  useEffect(() => {
    setMode('review');
    setReason('');
    setMatched(false);
    setAcknowledged(false);
    setError('');
    setBusy(null);
    if (item) closeRef.current?.focus();
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, busy, onClose]);

  if (!item) return null;
  const copy = COPY[item.kind];

  async function decide(decision: Decision) {
    if (!item) return;
    setBusy(decision);
    setError('');
    try {
      await resolve(item, decision, decision === 'reject' ? reason.trim() : undefined);
      notify(decision === 'approve' ? copy.approved(item.title) : copy.rejected(item.title));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setBusy(null);
    }
  }

  const flags = item.kind === 'application' ? item.data.flags ?? [] : [];
  const canApprove = item.kind === 'application' ? flags.length === 0 || acknowledged : matched;
  const canReject = reason.trim().length >= 5;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="review-title">
      <div className="absolute inset-0 bg-[#0F3325]/30" onClick={() => !busy && onClose()} />
      <section className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[#DDE3DE] px-6 py-5">
          <div>
            <p className="text-xs text-[#5E6B64]">{copy.heading}</p>
            <h2 id="review-title" className="mt-0.5 text-lg font-semibold leading-snug">{item.title}</h2>
            <p className="mt-1 text-xs text-[#5E6B64]">Waiting {waitingFor(item.submittedAt).toLowerCase()}</p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            disabled={!!busy}
            aria-label="Close"
            className="rounded-md p-1.5 text-[#5E6B64] hover:bg-[#EEF1EC] hover:text-[#17221D]"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {flags.length > 0 && (
            <div role="alert" className="mb-4 rounded-lg border border-[#F4C77B] bg-[#FFF7E8] p-3 text-sm text-[#7A4B00]">
              <p className="flex items-center gap-2 font-semibold">
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                {flags.length === 1 ? '1 warning' : `${flags.length} warnings`} found at registration
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-6">
                {flags.map((flag, i) => (
                  <li key={`${flag.code}-${i}`}>{flag.message}</li>
                ))}
              </ul>
            </div>
          )}

          <dl className="divide-y divide-[#EEF1EC]">
            {item.kind === 'application' ? (
              <>
                <Detail label="Applicant" value={item.data.applicant_name} />
                <Detail label="Email" value={<a className="text-[#176044] underline-offset-2 hover:underline" href={`mailto:${item.data.email}`}>{item.data.email}</a>} />
                <Detail label="Phone" value={<a className="text-[#176044] underline-offset-2 hover:underline" href={`tel:${item.data.phone}`}>{item.data.phone}</a>} />
                <Detail label="Admin ID no." value={item.data.admin_id_number ?? '—'} />
                <Detail label="Registration no." value={item.data.registration_number ?? '—'} />
                <Detail label="KRA PIN" value={item.data.kra_pin ?? '—'} />
                <Detail label="County" value={item.data.county ?? '—'} />
                <Detail label="Location" value={item.data.sub_county ?? item.data.location} />
                <Detail
                  label="Milk per day"
                  value={item.data.estimated_daily_liters != null ? `${formatNumber(item.data.estimated_daily_liters)} litres (estimate)` : '—'}
                />
                <Detail label="Coolers" value={item.data.initial_coolers_count != null ? formatNumber(item.data.initial_coolers_count) : '—'} />
                {item.data.additional_info && (
                  <Detail label="Notes" value={<span className="whitespace-pre-line">{item.data.additional_info}</span>} />
                )}
                <Detail label="Submitted" value={formatDateTime(item.data.created_at)} />
              </>
            ) : (
              <>
                <Detail label="Amount paid" value={<span className="font-semibold tabular-nums">{formatKes(item.data.amount_kes)}</span>} />
                <Detail label="Credits" value={<span className="tabular-nums">{formatNumber(item.data.credits_requested)}</span>} />
                {item.data.package_name && <Detail label="Package" value={item.data.package_name} />}
                <Detail label="M-Pesa code" value={<code className="rounded bg-[#EEF1EC] px-1.5 py-0.5 text-[13px]">{item.data.masked_mpesa_ref}</code>} />
                <Detail label="Submitted" value={formatDateTime(item.data.submitted_at)} />
              </>
            )}
          </dl>

          {flags.length > 0 && mode === 'review' && (
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-[#DDE3DE] p-3 text-sm">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 size-4 accent-[#176044]"
              />
              <span>
                I have checked these warnings.
                <span className="block text-xs text-[#5E6B64]">Approving creates the cooperative and activates the admin&apos;s account.</span>
              </span>
            </label>
          )}

          {item.kind === 'payment' && mode === 'review' && (
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-[#DDE3DE] p-3 text-sm">
              <input
                type="checkbox"
                checked={matched}
                onChange={(e) => setMatched(e.target.checked)}
                className="mt-0.5 size-4 accent-[#176044]"
              />
              <span>
                I found this M-Pesa code and amount in the paybill statement.
                <span className="block text-xs text-[#5E6B64]">Credits can&apos;t be taken back once issued.</span>
              </span>
            </label>
          )}

          {mode === 'rejecting' && (
            <div className="mt-5">
              <label htmlFor="reject-reason" className="text-sm font-medium">Reason for rejecting</label>
              <p className="text-xs text-[#5E6B64]">Saved to the activity log. At least 5 characters.</p>
              <textarea
                id="reject-reason"
                autoFocus
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={item.kind === 'application' ? 'e.g. Registration certificate could not be verified' : 'e.g. Code not found in the paybill statement'}
                className="mt-2 w-full rounded-lg border border-[#C9D2CB] px-3 py-2 text-sm outline-none focus:border-[#176044] focus:ring-2 focus:ring-[#176044]/20"
              />
            </div>
          )}

          {error && <p role="alert" className="mt-4 rounded-md bg-[#FDECEA] px-3 py-2 text-sm text-[#B42318]">{error}</p>}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-[#DDE3DE] px-6 py-4">
          {mode === 'review' ? (
            <>
              <button
                onClick={() => setMode('rejecting')}
                disabled={!!busy}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-[#B42318] hover:bg-[#FDECEA]"
              >
                Reject…
              </button>
              <button
                onClick={() => decide('approve')}
                disabled={!canApprove || !!busy}
                className="rounded-lg bg-[#176044] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#124D37] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'approve' ? 'Saving…' : copy.approve}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setMode('review')}
                disabled={!!busy}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-[#5E6B64] hover:bg-[#EEF1EC]"
              >
                Back
              </button>
              <button
                onClick={() => decide('reject')}
                disabled={!canReject || !!busy}
                className="rounded-lg bg-[#B42318] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#912018] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'reject' ? 'Saving…' : copy.reject}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
