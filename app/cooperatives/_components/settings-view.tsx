'use client';

// /cooperatives/settings
//   COOP_ADMIN  "Cooperative" (organisation settings: general, organisation, milk & collections, notifications,
//               SMS & credits, devices & sensors, activity) and "My account" (personal settings)
//   MANAGER     "My account" only, plus a read-only summary of the cooperative.
// Personal settings and cooperative administration are kept apart. Registration details are platform-controlled.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Building2, Gauge, MapPin, MessageSquareText, Milk, Smartphone, Snowflake, Tags, UserCog, Users } from 'lucide-react';
import { AccountSettings } from '@/components/settings/account-settings';
import { LockedValue, Notice, SettingsCard, Toggle, ValueRow } from '@/components/settings/settings-ui';
import { formatDateTime, formatKes, formatNumber, humanize } from '@/lib/format';
import { useIsOnline } from '@/lib/sync/hooks';
import { listCentres, listCoolers, listDevices, listSensors } from '../_api/coop-client';
import { getCreditCenter, listPrices, updateSmsSettings, type CreditCenter, type MilkPrice } from '../_api/finance-client';
import { useCoop } from './coop-context';
import type { Device, SensorDevice } from '@/app/superadmin/_types/platform-types';

type Tab = 'cooperative' | 'account';

function OrgLink({ href, icon: Icon, label, detail }: { href: string; icon: typeof Users; label: string; detail: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 rounded-lg border border-mo-line px-4 py-3 hover:bg-mo-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mo-brand/40">
        <Icon aria-hidden className="size-5 text-mo-brand" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-mo-ink">{label}</span>
          <span className="block text-sm text-mo-muted">{detail}</span>
        </span>
        <ArrowRight aria-hidden className="size-4 text-mo-subtle" />
      </Link>
    </li>
  );
}

function CooperativeSettings() {
  const { overview, refresh } = useCoop();
  const online = useIsOnline();
  const coop = overview.cooperative;
  const [credits, setCredits] = useState<CreditCenter | null>(null);
  const [price, setPrice] = useState<MilkPrice | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [sensors, setSensors] = useState<SensorDevice[] | null>(null);
  const [smsPrefs, setSmsPrefs] = useState({ receipt: coop.receipt_sms_enabled ?? true, alert: coop.alert_sms_enabled ?? true });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!online) return;
    getCreditCenter({ page_size: 5 }).then((c) => { setCredits(c); setSmsPrefs({ receipt: c.settings.receipt_sms_enabled, alert: c.settings.alert_sms_enabled }); }, () => undefined);
    listPrices().then((p) => setPrice(p.current), () => undefined);
    listDevices().then(setDevices, () => undefined);
    listSensors().then(setSensors, () => undefined);
    // Warm the local lists used by the links (best effort).
    void listCentres().catch(() => undefined);
    void listCoolers().catch(() => undefined);
  }, [online]);

  async function toggleSms(key: 'receipt_sms_enabled' | 'alert_sms_enabled', value: boolean) {
    setError('');
    try {
      const r = await updateSmsSettings({ [key]: value });
      setSmsPrefs({ receipt: r.receipt_sms_enabled, alert: r.alert_sms_enabled });
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  }

  const b = credits?.balances;
  const activeDevices = devices?.filter((d) => d.is_active).length ?? 0;
  return (
    <div className="space-y-4">
      {!online && <Notice tone="warn">You&apos;re offline. Cooperative settings need a connection to change; figures may be out of date.</Notice>}

      <SettingsCard id="general" title="General" description="Your cooperative's registered details. Contact MilkOS support to change registration details.">
        <dl className="divide-y divide-mo-line">
          <LockedValue label="Cooperative name" value={coop.name} note="Platform-controlled" />
          <LockedValue label="Cooperative code" value={<span className="font-mono">{coop.code}</span>} note="Platform-controlled" />
          <LockedValue label="Registration number" value={coop.registration_number} note="Platform-controlled" />
          <LockedValue label="KRA PIN" value={coop.kra_pin} note="Platform-controlled" />
          <LockedValue label="County" value={coop.county} note="Platform-controlled" />
          <LockedValue label="Location" value={coop.location} note="Platform-controlled" />
          <LockedValue label="Contact email" value={coop.contact_email} note="Platform-controlled" />
          <LockedValue label="Contact phone" value={coop.contact_phone} note="Platform-controlled" />
          <ValueRow label="Status" value={humanize(coop.status)} />
          <ValueRow label="On MilkOS since" value={coop.created_at ? formatDateTime(coop.created_at) : null} />
          <ValueRow label="Logo" value={<span className="text-mo-muted">Not available yet: logo upload needs file storage, which isn&apos;t configured.</span>} />
        </dl>
      </SettingsCard>

      <SettingsCard id="organisation" title="Organisation" description="Managed on their own pages.">
        <ul className="grid gap-2 sm:grid-cols-2">
          <OrgLink href="/cooperatives/team" icon={UserCog} label="Managers & collectors" detail={`${overview.team.managers} managers · ${overview.team.collectors} collectors`} />
          <OrgLink href="/cooperatives/farmers" icon={Users} label="Farmers" detail={`${formatNumber(overview.farmers.active)} active`} />
          <OrgLink href="/cooperatives/centres" icon={MapPin} label="Collection centres" detail={`${overview.centres.active} active`} />
          <OrgLink href="/cooperatives/operations" icon={Snowflake} label="Coolers" detail={`${overview.coolers.operational} of ${overview.coolers.total} operational`} />
          <OrgLink href="/cooperatives/sync" icon={Smartphone} label="Devices" detail={devices ? `${activeDevices} active device${activeDevices === 1 ? '' : 's'}` : 'Phones and tablets using MilkOS'} />
        </ul>
      </SettingsCard>

      <SettingsCard id="milk" title="Milk & collections" description="How milk is priced, checked and confirmed. Confirmed collections are never edited: corrections create a new version.">
        <dl className="divide-y divide-mo-line">
          <ValueRow label="Current milk price" value={price ? `${formatKes(price.price_per_kg)} per KG since ${formatDateTime(price.effective_from)}` : 'No price set'} />
          <ValueRow label="Collection validation" value="Allocations must equal the captured weight exactly" />
          <LockedValue label="Quality thresholds" value="Temperature and butterfat limits" note="Set by the platform" />
          <LockedValue label="Measurement" value="KG from the scale; litres derived with the recorded density" note="Set by the platform" />
        </dl>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link href="/cooperatives/pricing" className="inline-flex items-center gap-1 font-medium text-mo-brand hover:underline"><Tags aria-hidden className="size-4" />Milk pricing</Link>
          <Link href="/cooperatives/coolers" className="inline-flex items-center gap-1 font-medium text-mo-brand hover:underline"><Gauge aria-hidden className="size-4" />Cooler temperature & volume rules</Link>
          <Link href="/collections" className="inline-flex items-center gap-1 font-medium text-mo-brand hover:underline"><Milk aria-hidden className="size-4" />Collections</Link>
        </div>
      </SettingsCard>

      <SettingsCard id="notifications" title="Cooperative notifications" description="Messages MilkOS sends on the cooperative's behalf. Each SMS uses one credit.">
        <div className="divide-y divide-mo-line">
          <Toggle label="Collection receipts by SMS" help="Every farmer gets an SMS for each confirmed delivery." checked={smsPrefs.receipt} disabled={!online}
            onChange={(v) => void toggleSms('receipt_sms_enabled', v)} />
          <Toggle label="Cooler alerts by SMS" help="Admins and the responsible manager get SMS for cooler alerts." checked={smsPrefs.alert} disabled={!online}
            onChange={(v) => void toggleSms('alert_sms_enabled', v)} />
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <p className="mt-2 text-sm text-mo-muted">Your own in-app notifications are under My account.</p>
      </SettingsCard>

      <SettingsCard id="sms" title="SMS & credits" description="From the SMS credit ledger. Credits are added only after MilkOS verifies your M-Pesa payment."
        action={<Link href="/cooperatives/sms-credits" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-mo-brand px-4 text-sm font-semibold text-white hover:bg-mo-brand-strong"><MessageSquareText aria-hidden className="size-4" />Buy credits</Link>}>
        {b && credits ? (
          <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            <ValueRow label="Available" value={formatNumber(b.available)} />
            <ValueRow label="Reserved" value={formatNumber(b.reserved)} />
            <ValueRow label="Consumed" value={formatNumber(b.consumed)} />
            <ValueRow label="Refunded" value={formatNumber(b.refunded)} />
            <ValueRow label="Expired" value={formatNumber(b.expired)} />
            <ValueRow label={`Delivery (${credits.health.days} days)`} value={credits.health.success_rate == null ? 'No SMS yet' : `${Math.round(credits.health.success_rate * 100)}% accepted`} />
          </dl>
        ) : (
          <p className="text-sm text-mo-muted">{online ? 'Loading…' : 'Connect to see the ledger.'}</p>
        )}
        {credits && credits.health.pending_provider > 0 && (
          <div className="mt-3"><Notice tone="warn">{credits.health.pending_provider} SMS waiting: the SMS provider isn&apos;t configured. Contact MilkOS support.</Notice></div>
        )}
      </SettingsCard>

      <SettingsCard id="devices" title="Devices & sensors" description="Phones, scales and cooler sensors registered to your cooperative.">
        <dl className="divide-y divide-mo-line">
          <ValueRow label="Collector devices" value={devices ? `${activeDevices} active of ${devices.length}` : '–'} />
          <ValueRow label="Last device sync" value={devices?.length ? formatDateTime(devices.map((d) => d.last_sync_at).filter(Boolean).sort().at(-1) ?? null) : null} />
          <ValueRow label="Cooler sensors" value={sensors ? `${sensors.filter((s) => s.is_active).length} active${sensors.some((s) => s.is_simulated) ? ' (includes simulated)' : ''}` : '–'} />
          <ValueRow label="Scales" value={<span className="text-mo-muted">Each collector connects their scale in the collector app. No hardware scale model is configured yet: collectors use the simulator or type the weight (labelled manual).</span>} />
        </dl>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href="/cooperatives/sync" className="font-medium text-mo-brand hover:underline">Manage devices</Link>
          <Link href="/cooperatives/coolers" className="font-medium text-mo-brand hover:underline">Manage sensors</Link>
        </div>
      </SettingsCard>

      <SettingsCard id="activity" title="Activity" description="Every change made in your cooperative is recorded in the audit trail.">
        <Link href="/cooperatives/team" className="text-sm font-medium text-mo-brand hover:underline">See who has access</Link>
        <span className="mx-2 text-mo-subtle" aria-hidden>·</span>
        <Link href="/cooperatives/reports" className="text-sm font-medium text-mo-brand hover:underline">Reports & exports</Link>
      </SettingsCard>
    </div>
  );
}

export function CoopSettingsView() {
  const { overview } = useCoop();
  const isAdmin = overview.role === 'COOP_ADMIN';
  const [tab, setTab] = useState<Tab>(isAdmin ? 'cooperative' : 'account');
  const [centres, setCentres] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    listCentres().then((rows) => setCentres(rows.filter((c) => c.status === 'ACTIVE').map((c) => ({ id: c.id, name: c.name }))), () => undefined);
  }, []);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{isAdmin ? 'Settings' : 'My settings'}</h1>
        <p className="mt-1 text-mo-muted">{isAdmin ? 'Cooperative configuration and your personal account.' : 'Your personal account. Cooperative settings are managed by your administrator.'}</p>
      </header>
      {isAdmin && (
        <div role="tablist" aria-label="Settings" className="mb-6 flex gap-1 border-b border-mo-line">
          {([['cooperative', 'Cooperative', Building2], ['account', 'My account', UserCog]] as [Tab, string, typeof Users][]).map(([value, label, Icon]) => (
            <button key={value} role="tab" aria-selected={tab === value} aria-controls={`panel-${value}`} id={`tab-${value}`} onClick={() => setTab(value)}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium ${tab === value ? 'border-mo-brand text-mo-brand' : 'border-transparent text-mo-muted hover:text-mo-ink'}`}>
              <Icon aria-hidden className="size-4" />{label}
            </button>
          ))}
        </div>
      )}
      <div role={isAdmin ? 'tabpanel' : undefined} id={`panel-${tab}`} aria-labelledby={isAdmin ? `tab-${tab}` : undefined}>
        {tab === 'cooperative' && isAdmin ? (
          <CooperativeSettings />
        ) : (
          <AccountSettings
            workOptions={{ centres }}
            before={!isAdmin ? (
              <SettingsCard title="Your cooperative">
                <dl className="divide-y divide-mo-line">
                  <LockedValue label="Cooperative" value={`${overview.cooperative.name} (${overview.cooperative.code})`} />
                  <LockedValue label="Your role" value="Manager" />
                </dl>
              </SettingsCard>
            ) : undefined}
          />
        )}
      </div>
    </>
  );
}
