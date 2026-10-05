'use client';

import { useEffect, useState } from 'react';
import { Droplets, Milk, Snowflake, Truck, Users } from 'lucide-react';
import {
  ConfirmationDialog,
  DetailList,
  DetailRow,
  ErrorBanner,
  Field,
  FormDialog,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
  Tabs,
  dangerButton,
  inputClass,
  primaryButton,
  secondaryButton,
} from '@/components/admin';
import { formatDate, formatDateTime, formatKes, formatLitres, formatNumber, formatPhone } from '@/lib/format';
import { useResource } from '@/lib/hooks/use-resource';
import { useSubmit } from '@/lib/hooks/use-submit';
import { adjustSmsCredits, getCooperative, getSmsLedger, setCooperativeStatus } from '../../_api/superadmin-client';
import type { CooperativeDetail } from '../../_types/platform-types';
import { useToast } from '../toast';
import { AuditView } from './audit-view';
import { CollectionsView } from './collections-view';
import { CollectorsView } from './collectors-view';
import { AuditTrail } from './common';
import { CooperativeForm } from './cooperatives-view';
import { CoolersView } from './coolers-view';
import { FarmersView } from './farmers-view';
import { PaymentsView } from './payments-view';
import { ReportsView } from './reports-view';
import { UsersView } from './users-view';

const TABS = ['overview', 'farmers', 'collectors', 'managers', 'coolers', 'collections', 'payments', 'reports', 'activity', 'settings'] as const;
type Tab = (typeof TABS)[number];

/** The active tab lives in the URL hash (#farmers), so it can be linked to and survives a reload. */
function useHashTab(): [Tab, (t: Tab) => void] {
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.slice(1) as Tab;
      setTab(TABS.includes(hash) ? hash : 'overview');
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  return [
    tab,
    (t) => {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${t}`);
      setTab(t);
    },
  ];
}

export function CooperativeDetailView({ id }: { id: string }) {
  const coop = useResource(() => getCooperative(id), [id]);
  const [tab, setTab] = useHashTab();
  const c = coop.data;

  if (coop.error) return <ErrorBanner message={coop.error} onRetry={coop.reload} />;
  if (!c) return <LoadingState rows={6} />;

  return (
    <>
      <PageHeader
        back={{ href: '/superadmin/cooperatives', label: 'Cooperatives' }}
        title={c.name}
        badge={<StatusBadge status={c.status} />}
        subtitle={`${c.code} · ${c.county}${c.location ? `, ${c.location}` : ''} · on Milkflow since ${formatDate(c.created_at)}`}
      />
      {c.status === 'SUSPENDED' && (
        <div role="alert" className="mb-6 rounded-lg border border-[#F4C7C3] bg-[#FDECEA] px-4 py-3 text-sm text-[#912018]">
          Suspended {formatDateTime(c.suspended_at)}: {c.suspension_reason}. Its staff, collectors and farmers cannot use Milkflow until it is reactivated.
        </div>
      )}
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'farmers', label: 'Farmers', count: c.counts.farmers },
          { value: 'collectors', label: 'Collectors', count: c.counts.collectors },
          { value: 'managers', label: 'Managers', count: c.counts.managers },
          { value: 'coolers', label: 'Coolers', count: c.counts.coolers },
          { value: 'collections', label: 'Milk collections' },
          { value: 'payments', label: 'Payments', count: c.payments.pending || undefined },
          { value: 'reports', label: 'Reports' },
          { value: 'activity', label: 'Activity' },
          { value: 'settings', label: 'Settings' },
        ]}
      />
      {tab === 'overview' && <Overview c={c} goTo={setTab} />}
      {tab === 'farmers' && <FarmersView cooperativeId={id} embedded />}
      {tab === 'collectors' && <CollectorsView cooperativeId={id} embedded />}
      {tab === 'managers' && <UsersView cooperativeId={id} role="MANAGER" embedded />}
      {tab === 'coolers' && <CoolersView cooperativeId={id} embedded />}
      {tab === 'collections' && <CollectionsView cooperativeId={id} embedded />}
      {tab === 'payments' && <PaymentsView cooperativeId={id} embedded />}
      {tab === 'reports' && <ReportsView cooperativeId={id} embedded />}
      {tab === 'activity' && <AuditView cooperativeId={id} embedded />}
      {tab === 'settings' && <Settings c={c} onChanged={coop.reload} />}
    </>
  );
}

function Overview({ c, goTo }: { c: CooperativeDetail; goTo: (t: Tab) => void }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <button onClick={() => goTo('collections')} className="text-left"><StatCard label="Milk today" icon={Milk} value={formatLitres(c.milk.today)} hint={`${formatNumber(c.milk.collections_today)} collections`} /></button>
        <StatCard label="Last 7 days" icon={Droplets} value={formatLitres(c.milk.week)} />
        <StatCard label="Last 30 days" icon={Droplets} value={formatLitres(c.milk.month)} />
        <button onClick={() => goTo('farmers')} className="text-left"><StatCard label="Farmers" icon={Users} value={formatNumber(c.counts.farmers)} hint="active" /></button>
        <button onClick={() => goTo('collectors')} className="text-left"><StatCard label="Collectors" icon={Truck} value={formatNumber(c.counts.collectors)} hint={`${formatNumber(c.counts.managers)} managers`} /></button>
        <button onClick={() => goTo('coolers')} className="text-left"><StatCard label="Coolers" icon={Snowflake} value={formatNumber(c.counts.coolers)} hint={`${formatNumber(c.counts.centres ?? 0)} collection centres`} /></button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-xl border border-[#DDE3DE] bg-white p-5">
          <h2 className="text-base font-semibold">Cooperative</h2>
          <DetailList>
            <DetailRow label="Registration no." value={c.registration_number} />
            <DetailRow label="KRA PIN" value={c.kra_pin} />
            <DetailRow label="County" value={c.county} />
            <DetailRow label="Town" value={c.location ?? '–'} />
            <DetailRow label="Contact email" value={c.contact_email ?? '–'} />
            <DetailRow label="Contact phone" value={c.contact_phone ? formatPhone(c.contact_phone) : '–'} />
            <DetailRow label="Est. litres / day" value={c.estimated_daily_liters ? formatLitres(c.estimated_daily_liters) : '–'} />
            <DetailRow label="SMS credits" value={formatNumber(c.sms_credit_balance)} />
          </DetailList>
          <h3 className="pt-2 text-sm font-semibold">Administrators</h3>
          {c.administrators.length === 0 ? (
            <p className="text-sm text-[#B42318]">No administrator account. Create one from the Settings tab or Users.</p>
          ) : (
            <ul className="divide-y divide-[#EEF1EC] rounded-lg border border-[#EEF1EC] text-sm">
              {c.administrators.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.full_name}</span>
                    <span className="block truncate text-xs text-[#8A968F]">{a.email} · {formatPhone(a.phone_number)}</span>
                  </span>
                  <span className="text-right text-xs text-[#8A968F]">
                    <StatusBadge status={a.is_active ? 'ACTIVE' : 'INACTIVE'} />
                    <span className="mt-0.5 block">{a.last_login_at ? `Signed in ${formatDate(a.last_login_at)}` : 'Never signed in'}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border border-[#DDE3DE] bg-white p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold">SMS top-ups</h2>
              <button onClick={() => goTo('payments')} className="text-sm font-medium text-[#176044] hover:underline">All payments</button>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
              {[
                ['Pending', formatNumber(c.payments.pending)],
                ['Verified', formatNumber(c.payments.verified)],
                ['Paid to date', formatKes(c.payments.verified_amount_kes)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-[#EEF1EC] px-3 py-2">
                  <dt className="text-xs text-[#5E6B64]">{k}</dt>
                  <dd className="font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="rounded-xl border border-[#DDE3DE] bg-white p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-base font-semibold">Recent activity</h2>
              <button onClick={() => goTo('activity')} className="text-sm font-medium text-[#176044] hover:underline">Full activity</button>
            </div>
            <AuditTrail entries={c.recent_activity.slice(0, 5)} empty="Nothing recorded for this cooperative yet." />
          </section>
        </div>
      </div>
    </div>
  );
}

function Settings({ c, onChanged }: { c: CooperativeDetail; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [statusChange, setStatusChange] = useState(false);
  const [credits, setCredits] = useState(false);
  const suspended = c.status === 'SUSPENDED';

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#DDE3DE] bg-white p-5">
        <div>
          <h2 className="text-base font-semibold">Details</h2>
          <p className="text-sm text-[#5E6B64]">Name, registration, KRA PIN, county and contacts. Every change is audited.</p>
        </div>
        <button onClick={() => setEditing(true)} className={secondaryButton}>Edit details</button>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#DDE3DE] bg-white p-5">
        <div>
          <h2 className="text-base font-semibold">SMS credits</h2>
          <p className="text-sm text-[#5E6B64]">
            Balance <strong className="tabular-nums text-[#17221D]">{formatNumber(c.sms_credit_balance)}</strong>. Manual adjustments (bonuses, corrections) need a reason and are audited.
          </p>
        </div>
        <button onClick={() => setCredits(true)} className={secondaryButton}>Adjust credits</button>
        <SmsLedgerPanel cooperativeId={c.id} version={c.sms_credit_balance} />
      </section>

      <section className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5 ${suspended ? 'border-[#DDE3DE] bg-white' : 'border-[#F4C7C3] bg-[#FFFAF9]'}`}>
        <div>
          <h2 className="text-base font-semibold">{suspended ? 'Reactivate cooperative' : 'Suspend cooperative'}</h2>
          <p className="max-w-xl text-sm text-[#5E6B64]">
            {suspended
              ? 'Restores access for its administrators, managers, collectors and farmers.'
              : 'Immediately blocks its administrators, managers, collectors and farmers from the API. Records are kept, nothing is deleted.'}
          </p>
        </div>
        <button onClick={() => setStatusChange(true)} className={suspended ? primaryButton : dangerButton}>
          {suspended ? 'Reactivate' : 'Suspend'}
        </button>
      </section>

      {editing && (
        <CooperativeForm
          cooperative={c}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            toast('Details saved.');
            await onChanged();
          }}
        />
      )}
      {statusChange && (
        <ConfirmationDialog
          title={suspended ? `Reactivate ${c.name}?` : `Suspend ${c.name}?`}
          body={suspended ? 'Everyone in the cooperative can use Milkflow again.' : 'Everyone in the cooperative loses access on their next request until you reactivate it.'}
          confirmLabel={suspended ? 'Reactivate' : 'Suspend cooperative'}
          danger={!suspended}
          reason={{ label: 'Reason', required: !suspended, placeholder: suspended ? 'Optional' : 'e.g. Registration certificate expired' }}
          onClose={() => setStatusChange(false)}
          onConfirm={async (reason) => {
            await setCooperativeStatus(c.id, suspended ? 'ACTIVE' : 'SUSPENDED', reason || undefined);
            setStatusChange(false);
            toast(suspended ? `${c.name} reactivated.` : `${c.name} suspended.`);
            await onChanged();
          }}
        />
      )}
      {credits && (
        <CreditsDialog
          balance={c.sms_credit_balance}
          onClose={() => setCredits(false)}
          onSave={async (delta, reason) => {
            await adjustSmsCredits(c.id, delta, reason);
            setCredits(false);
            toast('SMS credits adjusted.');
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function CreditsDialog({ balance, onClose, onSave }: { balance: number; onClose: () => void; onSave: (delta: number, reason: string) => Promise<void> }) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const delta = (direction === 'add' ? 1 : -1) * (Number(amount) || 0);
  return (
    <FormDialog title="Adjust SMS credits" onClose={onClose} busy={busy} error={formError} submitLabel="Apply adjustment" onSubmit={() => run(() => onSave(delta, reason))}>
      <div className="flex gap-2">
        {(['add', 'remove'] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDirection(d)} className={direction === d ? primaryButton : secondaryButton}>
            {d === 'add' ? 'Add credits' : 'Remove credits'}
          </button>
        ))}
      </div>
      <Field label="Credits" required error={fieldErrors.delta}>
        {(p) => <input {...p} inputMode="numeric" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} autoFocus />}
      </Field>
      <Field label="Reason" required error={fieldErrors.reason} hint="Saved to the audit log. At least 5 characters.">
        {(p) => <input {...p} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Launch bonus" />}
      </Field>
      <p className="text-sm text-[#5E6B64]">
        New balance: <strong className="tabular-nums text-[#17221D]">{formatNumber(balance + delta)}</strong>
      </p>
    </FormDialog>
  );
}


/** The cooperative's SMS credit ledger: balances derived from entries, and the latest entries. */
function SmsLedgerPanel({ cooperativeId, version }: { cooperativeId: string; version: number }) {
  const ledger = useResource(() => getSmsLedger(cooperativeId), [cooperativeId, version]);
  const b = ledger.data?.balances;
  return (
    <div className="w-full">
      {b && (
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          {([['Available', b.available], ['Reserved', b.reserved], ['Consumed', b.consumed], ['Refunded', b.refunded], ['Purchased', b.purchased]] as const).map(([label, value]) => (
            <div key={label} className="rounded-lg bg-[#F6F7F4] px-3 py-2">
              <dt className="text-xs text-[#5E6B64]">{label}</dt>
              <dd className="font-semibold tabular-nums">{formatNumber(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {ledger.data && ledger.data.transactions.length > 0 && (
        <ul className="mt-3 divide-y divide-[#EEF1EC] text-sm">
          {ledger.data.transactions.map((t) => (
            <li key={t.id} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span>{t.transaction_type.charAt(0) + t.transaction_type.slice(1).toLowerCase()} <span className="font-mono text-xs text-[#8A968F]">{t.reference}</span></span>
              <span className="tabular-nums">{t.amount > 0 ? '+' : ''}{formatNumber(t.amount)} · {formatDateTime(t.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
