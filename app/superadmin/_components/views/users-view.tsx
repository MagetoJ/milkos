'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, UserCog } from 'lucide-react';
import {
  ConfirmationDialog,
  DataTable,
  DetailList,
  DetailPanel,
  DetailRow,
  DetailSection,
  EmptyState,
  ErrorBanner,
  Field,
  FilterBar,
  FilterSelect,
  FormDialog,
  LoadingState,
  Muted,
  Pagination,
  PrimaryCell,
  RoleBadge,
  SearchInput,
  dangerButton,
  inputClass,
  primaryButton,
  roleLabel,
  secondaryButton,
  type Column,
} from '@/components/admin';
import type { UserRole } from '@/lib/auth';
import { AccountStatusBadge, ActivationLine, PhoneVerified, accountState, smsOutcomeMessage } from '@/components/accounts/account-status';
import { formatDateTime, formatPhone, maskPhone } from '@/lib/format';
import { useListState } from '@/lib/hooks/use-list-state';
import { useResource } from '@/lib/hooks/use-resource';
import { useSubmit } from '@/lib/hooks/use-submit';
import {
  createUser,
  getUser,
  listFarmers,
  listUsers,
  resendUserActivation,
  revokeUserInvitation,
  sendUserPasswordReset,
  setUserAccountStatus,
  updateUser,
} from '../../_api/superadmin-client';
import type { PlatformUser } from '../../_types/platform-types';
import { useToast } from '../toast';
import { AuditTrail, useCooperativeOptions, useFocusParam } from './common';

const ROLES: UserRole[] = ['SUPER_ADMIN', 'COOP_ADMIN', 'MANAGER', 'COLLECTOR', 'FARMER'];

export function UsersView({ cooperativeId, role, embedded }: { cooperativeId?: string; role?: UserRole; embedded?: boolean }) {
  const toast = useToast();
  const initialRole = role ?? (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('role') ?? '' : '');
  const list = useListState({ filters: { role: initialRole, cooperative_id: cooperativeId ?? '', account_status: '' } });
  const data = useResource(() => listUsers(list.params), [JSON.stringify(list.params)]);
  const coops = useCooperativeOptions(!cooperativeId);
  const [focus, setFocus] = useFocusParam();
  const [editing, setEditing] = useState<PlatformUser | 'new' | null>(null);

  const columns: Column<PlatformUser>[] = [
    { key: 'name', header: 'Name', sortKey: 'full_name', cell: (u) => <PrimaryCell title={u.full_name} subtitle={u.email} /> },
    { key: 'phone', header: 'Phone', cell: (u) => <span className="whitespace-nowrap"><span className="block tabular-nums">{formatPhone(u.phone_number)}</span><PhoneVerified verified={u.phone_verified} /></span> },
    { key: 'role', header: 'Role', sortKey: 'role', cell: (u) => <RoleBadge role={u.role} /> },
    { key: 'coop', header: 'Cooperative', hidden: !!cooperativeId, cell: (u) => u.cooperative_name ?? <Muted>Platform</Muted> },
    { key: 'login', header: 'Last sign-in', sortKey: 'last_login_at', cell: (u) => (u.last_login_at ? formatDateTime(u.last_login_at) : <Muted>Never</Muted>) },
    { key: 'status', header: 'Account', cell: (u) => <span><AccountStatusBadge state={accountState(u)} />{accountState(u) === 'PENDING_ACTIVATION' && <ActivationLine activation={u.activation} />}</span> },
  ];

  return (
    <>
      {!embedded && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
            <p className="mt-1 text-[#5E6B64]">Every account on the platform: platform staff, cooperative admins, managers, collectors and farmers.</p>
          </div>
          <button onClick={() => setEditing('new')} className={primaryButton}>
            <Plus className="size-4" /> New user
          </button>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={data.data?.items}
        rowKey={(u) => u.id}
        loading={data.loading}
        error={data.error}
        onRetry={data.reload}
        sort={list.sort}
        onSort={list.setSort}
        onRowClick={(u) => setFocus(u.id)}
        rowClassName={(u) => (accountState(u) === 'DISABLED' ? 'text-mo-subtle' : '')}
        toolbar={
          <FilterBar onReset={list.reset} filtered={list.isFiltered}>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name, email or phone" label="Search users" />
            {!role && (
              <FilterSelect label="Role" value={list.filters.role} onChange={(v) => list.setFilter('role', v)} allLabel="All roles" options={ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} />
            )}
            {!cooperativeId && (
              <FilterSelect
                label="Cooperative"
                value={list.filters.cooperative_id}
                onChange={(v) => list.setFilter('cooperative_id', v)}
                allLabel="All cooperatives"
                options={[{ value: 'none', label: 'Platform accounts' }, ...coops]}
              />
            )}
            <FilterSelect label="Account status" value={list.filters.account_status} onChange={(v) => list.setFilter('account_status', v)} allLabel="Any status"
              options={[{ value: 'PENDING_ACTIVATION', label: 'Pending activation' }, { value: 'ACTIVE', label: 'Active' }, { value: 'SUSPENDED', label: 'Suspended' }, { value: 'DISABLED', label: 'Disabled' }, { value: 'PENDING_APPROVAL', label: 'Awaiting approval' }]} />
            {embedded && (
              <button onClick={() => setEditing('new')} className={`${secondaryButton} ml-auto`}>
                <Plus className="size-4" /> Add {role ? roleLabel(role).toLowerCase() : 'user'}
              </button>
            )}
          </FilterBar>
        }
        empty={<EmptyState icon={<UserCog className="size-8" />} title={list.isFiltered ? 'No users match' : 'No users yet'} body={list.isFiltered ? 'Try a different search or clear the filters.' : undefined} />}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={data.data?.total ?? 0} onPage={list.setPage} />}
      />

      {focus && (
        <UserPanel
          id={focus}
          onClose={() => setFocus(null)}
          onEdit={(u) => setEditing(u)}
          onChanged={() => void data.reload()}
        />
      )}
      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
          cooperativeId={cooperativeId}
          role={role}
          onClose={() => setEditing(null)}
          onSaved={(u, created) => {
            setEditing(null);
            const sms = smsOutcomeMessage(u.activation_sms);
            toast(created ? `${u.full_name} created and waiting for activation. ${sms.text}` : `${u.full_name} updated.`, sms.ok ? 'success' : 'error');
            void data.reload();
            setFocus(u.id);
          }}
        />
      )}
    </>
  );
}

function UserPanel({
  id,
  onClose,
  onEdit,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onEdit: (u: PlatformUser) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const user = useResource(() => getUser(id), [id]);
  const [confirm, setConfirm] = useState<'suspend' | 'disable' | 'activate' | 'revoke' | 'reset' | null>(null);
  const [busy, setBusy] = useState(false);
  const u = user.data;
  const state = u ? accountState(u) : null;

  async function resend() {
    if (!u) return;
    setBusy(true);
    try {
      const r = await resendUserActivation(u.id);
      const sms = smsOutcomeMessage(r.activation_sms);
      toast(sms.ok ? `New activation link sent to ${maskPhone(u.phone_number)}.` : sms.text, sms.ok ? 'success' : 'error');
      await user.reload();
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send the link.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailPanel
      title={u?.full_name ?? 'User'}
      subtitle={u?.email ?? (u ? maskPhone(u.phone_number) : undefined)}
      badge={u && state && <AccountStatusBadge state={state} />}
      onClose={onClose}
      actions={
        u && (
          <>
            {state === 'PENDING_ACTIVATION' && (
              <>
                <button onClick={() => void resend()} disabled={busy} className={secondaryButton}>{busy ? 'Sending…' : 'Resend activation link'}</button>
                <button onClick={() => setConfirm('revoke')} className={dangerButton}>Revoke invitation</button>
              </>
            )}
            {state === 'ACTIVE' && (
              <>
                <button onClick={() => setConfirm('reset')} className={secondaryButton}>Send password reset</button>
                <button onClick={() => setConfirm('suspend')} className={dangerButton}>Suspend</button>
              </>
            )}
            {(state === 'SUSPENDED' || state === 'DISABLED') && <button onClick={() => setConfirm('activate')} className={secondaryButton}>Reactivate</button>}
            {state !== 'DISABLED' && state !== 'PENDING_ACTIVATION' && <button onClick={() => setConfirm('disable')} className={dangerButton}>Disable</button>}
            <button onClick={() => onEdit(u)} className={primaryButton}>Edit</button>
          </>
        )
      }
    >
      {user.error && <ErrorBanner message={user.error} onRetry={user.reload} />}
      {!u && !user.error && <LoadingState rows={4} />}
      {u && (
        <>
          <DetailSection title="Account">
            <DetailList>
              <DetailRow label="Role" value={<RoleBadge role={u.role} />} />
              <DetailRow
                label="Cooperative"
                value={u.cooperative_id ? <Link className="text-[#176044] hover:underline" href={`/superadmin/cooperatives/${u.cooperative_id}`}>{u.cooperative_name}</Link> : 'Platform account'}
              />
              <DetailRow label="Phone" value={<>{formatPhone(u.phone_number)} <PhoneVerified verified={u.phone_verified} /></>} />
              <DetailRow label="Account status" value={<>{state && <AccountStatusBadge state={state} />}{u.status_reason ? <span className="ml-2 text-xs text-mo-muted">{u.status_reason}</span> : null}</>} />
              {state === 'PENDING_ACTIVATION' && <DetailRow label="Activation" value={<ActivationLine activation={u.activation} />} />}
              <DetailRow label="Two-step verification" value={u.mfa_enabled ? 'On' : 'Off'} />
              <DetailRow label="Activated" value={u.activated_at ? formatDateTime(u.activated_at) : '–'} />
              <DetailRow label="Last sign-in" value={u.last_login_at ? formatDateTime(u.last_login_at) : 'Never'} />
              <DetailRow label="Created" value={formatDateTime(u.created_at)} />
            </DetailList>
          </DetailSection>
          <DetailSection title={`Permissions (${u.permissions.length})`}>
            <div className="flex flex-wrap gap-1.5">
              {u.permissions.map((p) => (
                <code key={p} className="rounded bg-[#EEF1EC] px-1.5 py-0.5 text-xs text-[#394640]">{p}</code>
              ))}
            </div>
            <p className="mt-2 text-xs text-[#8A968F]">Set by the role. Non-platform roles only ever act inside their own cooperative.</p>
          </DetailSection>
          <DetailSection title="Activity">
            <AuditTrail entries={u.activity} />
          </DetailSection>
        </>
      )}

      {u && (confirm === 'suspend' || confirm === 'disable' || confirm === 'activate') && (
        <ConfirmationDialog
          title={`${confirm === 'activate' ? 'Reactivate' : confirm === 'suspend' ? 'Suspend' : 'Disable'} ${u.full_name}?`}
          body={confirm === 'activate'
            ? 'They can sign in again. If they never activated their account, a new activation link is sent instead.'
            : 'They are signed out everywhere immediately and cannot sign in until reactivated. Their records stay.'}
          confirmLabel={confirm === 'activate' ? 'Reactivate' : confirm === 'suspend' ? 'Suspend' : 'Disable'}
          danger={confirm !== 'activate'}
          reason={{ label: 'Reason', required: confirm !== 'activate', placeholder: 'e.g. Left the cooperative' }}
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            await setUserAccountStatus(u.id, confirm === 'activate' ? 'ACTIVE' : confirm === 'suspend' ? 'SUSPENDED' : 'DISABLED', reason || undefined);
            setConfirm(null);
            toast(`${u.full_name} ${confirm === 'activate' ? 'reactivated' : confirm === 'suspend' ? 'suspended' : 'disabled'}.`);
            await user.reload();
            onChanged();
          }}
        />
      )}
      {u && confirm === 'revoke' && (
        <ConfirmationDialog
          title={`Revoke ${u.full_name}'s invitation?`}
          body="Their activation link stops working and the account is disabled. Reactivate it later to send a new link."
          confirmLabel="Revoke invitation"
          danger
          reason={{ label: 'Reason', required: false }}
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            await revokeUserInvitation(u.id, reason || undefined);
            setConfirm(null);
            toast('Invitation revoked.');
            await user.reload();
            onChanged();
          }}
        />
      )}
      {u && confirm === 'reset' && (
        <ConfirmationDialog
          title={`Send ${u.full_name} a password reset link?`}
          body={`A one-time link goes by SMS to ${maskPhone(u.phone_number)}. You never see or set their password; their current one keeps working until they use the link.`}
          confirmLabel="Send reset link"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const r = await sendUserPasswordReset(u.id);
            setConfirm(null);
            toast(r.sms_sent ? 'Reset link sent.' : `The reset link could not be sent${r.sms_error ? `: ${r.sms_error}` : ''}.`, r.sms_sent ? 'success' : 'error');
          }}
        />
      )}
    </DetailPanel>
  );
}

function UserForm({
  user,
  cooperativeId,
  role,
  onClose,
  onSaved,
}: {
  user: PlatformUser | null;
  cooperativeId?: string;
  role?: UserRole;
  onClose: () => void;
  onSaved: (u: PlatformUser, created: boolean) => void;
}) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const coops = useCooperativeOptions(!cooperativeId);
  const [f, setF] = useState({
    full_name: user?.full_name ?? '',
    email: user?.email ?? '',
    phone: user ? formatPhone(user.phone_number) : '',
    role: (user?.role ?? role ?? 'MANAGER') as UserRole,
    cooperative_id: user?.cooperative_id ?? cooperativeId ?? '',
    farmer_id: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const platform = f.role === 'SUPER_ADMIN';
  const lockedRole = !!user && (user.role === 'SUPER_ADMIN' || user.role === 'FARMER');
  const farmers = useResource(
    () => (!user && f.role === 'FARMER' && f.cooperative_id ? listFarmers({ cooperative_id: f.cooperative_id, page_size: 100, status: 'ACTIVE' }) : Promise.resolve(null)),
    [user, f.role, f.cooperative_id],
  );

  async function submit() {
    let saved: PlatformUser | undefined;
    const ok = await run(async () => {
      if (user) {
        saved = await updateUser(user.id, {
          full_name: f.full_name,
          email: f.email,
          phone: f.phone,
          ...(lockedRole ? {} : { role: f.role }),
          ...(platform ? {} : { cooperative_id: f.cooperative_id || null }),
        });
      } else {
        saved = await createUser({
          full_name: f.full_name,
          email: f.email.trim() || null,
          phone: f.phone,
          role: f.role,
          cooperative_id: platform ? null : f.cooperative_id || null,
          farmer_id: f.role === 'FARMER' ? f.farmer_id || null : null,
        });
      }
    });
    if (ok && saved) onSaved(saved, !user);
  }

  return (
    <FormDialog title={user ? `Edit ${user.full_name}` : 'New user'} onClose={onClose} onSubmit={submit} busy={busy} error={formError} submitLabel={user ? 'Save changes' : 'Create user'} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={fieldErrors.full_name}>
          {(p) => <input {...p} className={inputClass} value={f.full_name} onChange={set('full_name')} autoFocus />}
        </Field>
        <Field label={['COLLECTOR', 'FARMER'].includes(f.role) ? 'Email (optional)' : 'Email'} required={!['COLLECTOR', 'FARMER'].includes(f.role)} error={fieldErrors.email}>
          {(p) => <input {...p} type="email" className={inputClass} value={f.email} onChange={set('email')} />}
        </Field>
        <Field label="Phone" required error={fieldErrors.phone} hint={!user ? 'Activation SMS will be sent to this phone number.' : 'A changed number must be verified by its owner.'}>
          {(p) => <input {...p} type="tel" className={inputClass} value={f.phone} onChange={set('phone')} placeholder="0712 345 678" />}
        </Field>
        <Field label="Role" required error={fieldErrors.role} hint={lockedRole ? 'Superadmin and farmer roles cannot be changed.' : undefined}>
          {(p) => (
            <select {...p} className={inputClass} value={f.role} onChange={set('role')} disabled={lockedRole || (!!role && !user)}>
              {ROLES.filter((r) => (user ? lockedRole || !['SUPER_ADMIN', 'FARMER'].includes(r) : true)).map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
          )}
        </Field>
        {!platform && (
          <Field label="Cooperative" required error={fieldErrors.cooperative_id} hint={user && ['COLLECTOR', 'FARMER'].includes(user.role) ? "Collectors and farmers can't move cooperatives." : undefined}>
            {(p) => (
              <select {...p} className={inputClass} value={f.cooperative_id} onChange={set('cooperative_id')} disabled={!!cooperativeId || (!!user && ['COLLECTOR', 'FARMER'].includes(user.role))}>
                <option value="">Choose a cooperative</option>
                {cooperativeId && !coops.length && <option value={cooperativeId}>This cooperative</option>}
                {coops.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            )}
          </Field>
        )}
        {!user && f.role === 'FARMER' && (
          <Field label="Farmer record" required error={fieldErrors.farmer_id} hint="The account signs in as this farmer and sees only their deliveries.">
            {(p) => (
              <select {...p} className={inputClass} value={f.farmer_id} onChange={set('farmer_id')} disabled={!f.cooperative_id}>
                <option value="">Choose a farmer</option>
                {(farmers.data?.items ?? []).filter((x) => !x.has_account).map((x) => (
                  <option key={x.id} value={x.id}>{x.full_name} ({x.farmer_number})</option>
                ))}
              </select>
            )}
          </Field>
        )}
      </div>
      {!user && (
        <p className="rounded-lg border border-mo-info/20 bg-mo-info-soft px-3 py-2 text-sm text-mo-info">
          The account is created <strong>waiting for activation</strong> and an SMS activation link is sent to {f.phone ? maskPhone(f.phone) || 'this number' : 'the phone above'}.
          The person chooses their own password; nobody else ever sees it.
        </p>
      )}
      {platform && !user && (
        <p className="rounded-lg border border-[#F4C77B] bg-[#FFF7E8] px-3 py-2 text-sm text-[#7A4B00]">
          A superadmin can see and change everything on the platform. Only create one for trusted platform staff.
        </p>
      )}
    </FormDialog>
  );
}
