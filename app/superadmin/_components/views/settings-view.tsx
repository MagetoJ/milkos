'use client';

import { useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import {
  ErrorBanner,
  Field,
  FormDialog,
  LoadingState,
  Spinner,
  StatusBadge,
  Tabs,
  inputClass,
  primaryButton,
  roleLabel,
  secondaryButton,
} from '@/components/admin';
import { formatDateTime, formatKes, formatNumber, humanize } from '@/lib/format';
import { useResource } from '@/lib/hooks/use-resource';
import { useSubmit } from '@/lib/hooks/use-submit';
import { createSmsPackage, getRoles, getSettings, listSmsPackages, saveSettings, updateSmsPackage } from '../../_api/superadmin-client';
import type { Setting, SmsPackage } from '../../_types/platform-types';
import { useToast } from '../toast';

type Section = 'settings' | 'packages' | 'roles';

export function SettingsView() {
  const [section, setSection] = useState<Section>('settings');
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-[#5E6B64]">Platform configuration, SMS credit packages and what each role may do.</p>
      </div>
      <Tabs
        active={section}
        onChange={setSection}
        tabs={[
          { value: 'settings', label: 'Platform settings' },
          { value: 'packages', label: 'SMS packages' },
          { value: 'roles', label: 'Roles & permissions' },
        ]}
      />
      {section === 'settings' && <PlatformSettings />}
      {section === 'packages' && <Packages />}
      {section === 'roles' && <Roles />}
    </>
  );
}

function toInput(s: Setting): string | boolean {
  if (s.type === 'boolean') return Boolean(s.value);
  return s.value == null ? '' : String(s.value);
}

function PlatformSettings() {
  const settings = useResource(getSettings, []);
  if (settings.error) return <ErrorBanner message={settings.error} onRetry={settings.reload} />;
  if (!settings.data) return <LoadingState />;
  // Re-keyed on every load so the form starts from the saved values.
  const key = settings.data.map((s) => `${s.key}=${String(s.value)}`).join('|');
  return <SettingsForm key={key} settings={settings.data} reload={settings.reload} />;
}

function SettingsForm({ settings, reload }: { settings: Setting[]; reload: () => Promise<void> }) {
  const toast = useToast();
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(settings.map((s) => [s.key, toInput(s)])),
  );
  const changed = settings.filter((s) => values[s.key] !== toInput(s));
  const groups = Array.from(new Set(settings.map((s) => s.group)));

  async function save() {
    const payload = Object.fromEntries(
      changed.map((s) => {
        const v = values[s.key];
        if (s.type === 'boolean') return [s.key, v];
        if (v === '') return [s.key, null];
        return [s.key, s.type === 'number' || s.type === 'integer' ? Number(v) : v];
      }),
    );
    if (await run(async () => void (await saveSettings(payload)))) {
      toast('Settings saved.');
      await reload();
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-6"
    >
      {groups.map((group) => (
        <section key={group} className="rounded-xl border border-[#DDE3DE] bg-white px-5 py-4">
          <h2 className="mb-4 text-base font-semibold">{group}</h2>
          <div className="grid gap-5 md:grid-cols-2">
            {settings.filter((s) => s.group === group).map((s) =>
              s.type === 'boolean' ? (
                <label key={s.key} className="flex items-start gap-3 text-sm md:col-span-2">
                  <input
                    type="checkbox"
                    checked={Boolean(values[s.key])}
                    onChange={(e) => setValues({ ...values, [s.key]: e.target.checked })}
                    className="mt-0.5 size-4 accent-[#176044]"
                  />
                  <span>
                    <span className="font-medium">{s.label}</span>
                    <span className="block text-xs text-[#8A968F]">{s.help}</span>
                  </span>
                </label>
              ) : (
                <Field key={s.key} label={s.label} hint={s.help + (s.updated_at ? ` Last changed ${formatDateTime(s.updated_at)}.` : '')} error={fieldErrors[s.key]}>
                  {(p) => (
                    <input
                      {...p}
                      className={inputClass}
                      inputMode={s.type === 'number' || s.type === 'integer' ? 'decimal' : undefined}
                      type={s.type === 'email' ? 'email' : s.type === 'phone' ? 'tel' : 'text'}
                      value={String(values[s.key] ?? '')}
                      onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
                    />
                  )}
                </Field>
              ),
            )}
          </div>
        </section>
      ))}
      {formError && <ErrorBanner message={formError} />}
      <div className="flex items-center justify-end gap-3">
        {changed.length > 0 && <span className="text-sm text-[#5E6B64]">{changed.length} unsaved {changed.length === 1 ? 'change' : 'changes'}</span>}
        <button type="submit" disabled={busy || changed.length === 0} className={primaryButton}>
          {busy && <Spinner />}
          Save settings
        </button>
      </div>
    </form>
  );
}

function Packages() {
  const toast = useToast();
  const packages = useResource(listSmsPackages, []);
  const [editing, setEditing] = useState<SmsPackage | 'new' | null>(null);

  return (
    <section className="rounded-xl border border-[#DDE3DE] bg-white">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">SMS credit packages</h2>
          <p className="text-sm text-[#5E6B64]">What cooperatives can buy. Price changes apply to new top-ups only.</p>
        </div>
        <button onClick={() => setEditing('new')} className={secondaryButton}>
          <Plus className="size-4" /> Add package
        </button>
      </div>
      {packages.error && <div className="px-5 pb-4"><ErrorBanner message={packages.error} onRetry={packages.reload} /></div>}
      {!packages.data && !packages.error && <LoadingState rows={3} />}
      {packages.data && (
        <table className="w-full text-sm">
          <thead className="border-y border-[#EEF1EC] text-left text-xs uppercase tracking-wide text-[#8A968F]">
            <tr>
              <th className="px-5 py-2 font-medium">Package</th>
              <th className="px-3 py-2 text-right font-medium">Credits</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-5 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF1EC]">
            {packages.data.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-[#5E6B64]">No packages yet.</td></tr>}
            {packages.data.map((p) => (
              <tr key={p.id}>
                <td className="px-5 py-2.5 font-medium">{p.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(p.credits_amount)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatKes(p.price_kes)}</td>
                <td className="px-3 py-2.5"><StatusBadge status={p.is_active ? 'ACTIVE' : 'INACTIVE'} label={p.is_active ? 'On sale' : 'Hidden'} /></td>
                <td className="px-5 py-2.5 text-right">
                  <button onClick={() => setEditing(p)} className="text-sm font-medium text-[#176044] hover:underline">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <PackageForm
          pkg={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast('Package saved.');
            void packages.reload();
          }}
        />
      )}
    </section>
  );
}

function PackageForm({ pkg, onClose, onSaved }: { pkg: SmsPackage | null; onClose: () => void; onSaved: () => void }) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [f, setF] = useState({
    name: pkg?.name ?? '',
    credits_amount: pkg?.credits_amount.toString() ?? '',
    price_kes: pkg?.price_kes.toString() ?? '',
    is_active: pkg?.is_active ?? true,
  });
  async function submit() {
    const body = { name: f.name, credits_amount: Number(f.credits_amount), price_kes: Number(f.price_kes), is_active: f.is_active };
    if (await run(async () => void (pkg ? await updateSmsPackage(pkg.id, body) : await createSmsPackage(body)))) onSaved();
  }
  return (
    <FormDialog title={pkg ? `Edit ${pkg.name}` : 'New SMS package'} onClose={onClose} onSubmit={submit} busy={busy} error={formError} submitLabel="Save package">
      <Field label="Name" required error={fieldErrors.name}>
        {(p) => <input {...p} className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Credits" required error={fieldErrors.credits_amount}>
          {(p) => <input {...p} inputMode="numeric" className={inputClass} value={f.credits_amount} onChange={(e) => setF({ ...f, credits_amount: e.target.value })} />}
        </Field>
        <Field label="Price (KES)" required error={fieldErrors.price_kes}>
          {(p) => <input {...p} inputMode="decimal" className={inputClass} value={f.price_kes} onChange={(e) => setF({ ...f, price_kes: e.target.value })} />}
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-[#176044]" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />
        On sale to cooperatives
      </label>
    </FormDialog>
  );
}

function Roles() {
  const roles = useResource(getRoles, []);
  if (roles.error) return <ErrorBanner message={roles.error} onRetry={roles.reload} />;
  if (!roles.data) return <LoadingState />;
  const names = Object.keys(roles.data.roles);
  return (
    <section className="rounded-xl border border-[#DDE3DE] bg-white">
      <div className="px-5 py-4">
        <h2 className="text-base font-semibold">Roles &amp; permissions</h2>
        <p className="text-sm text-[#5E6B64]">
          Enforced by the API on every request. Apart from superadmins, every role is also limited to its own cooperative; collectors see only their own collections and farmers only their own deliveries.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-y border-[#EEF1EC] text-xs uppercase tracking-wide text-[#8A968F]">
            <tr>
              <th className="px-5 py-2 text-left font-medium">Permission</th>
              {names.map((n) => <th key={n} className="px-3 py-2 text-center font-medium">{roleLabel(n)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF1EC]">
            {roles.data.permissions.map((perm) => (
              <tr key={perm}>
                <td className="px-5 py-2">
                  <code className="text-xs text-[#394640]">{perm}</code>
                  <span className="ml-2 text-xs text-[#8A968F]">{humanize(perm.split('.').reverse().join(' '))}</span>
                </td>
                {names.map((n) => (
                  <td key={n} className="px-3 py-2 text-center">
                    {roles.data!.roles[n].includes(perm) ? (
                      <Check className="mx-auto size-4 text-[#176044]" aria-label="Allowed" />
                    ) : (
                      <Minus className="mx-auto size-4 text-[#C9D2CB]" aria-label="Not allowed" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
