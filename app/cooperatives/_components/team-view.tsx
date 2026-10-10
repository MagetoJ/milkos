'use client';

import { useReloadOn } from '@/lib/sync/hooks';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { KeyRound, MessageSquareText, Pencil, Plus, Send } from 'lucide-react';
import { useToast } from '@/app/superadmin/_components/toast';
import {
  AccountStatusBadge, ActivationLine, PhoneVerified, accountState, smsOutcomeMessage,
} from '@/components/accounts/account-status';
import { formatDateTime, maskPhone } from '@/lib/format';
import {
  createMember, listTeam, resendActivation, revokeInvitation, sendPasswordReset, setAccountStatus, updateMember,
} from '../_api/coop-client';
import { formatPhone } from '../_lib/format';
import { useResource } from '../_lib/use-resource';
import { useSubmit } from '../_lib/use-submit';
import type { TeamMember, TeamRole } from '../_types/coop-types';
import { useCoop } from './coop-context';
import {
  ConfirmModal,
  EmptyState,
  ErrorBanner,
  Field,
  LoadingRows,
  Modal,
  PageHeader,
  Spinner,
  inputClass,
  primaryButton,
  secondaryButton,
} from './ui';

const ROLE_LABEL: Record<string, string> = {
  COOP_ADMIN: 'Administrator',
  MANAGER: 'Manager',
  COLLECTOR: 'Collector',
  FARMER: 'Farmer',
};

type Dialog =
  | { kind: 'add'; role?: TeamRole }
  | { kind: 'edit'; member: TeamMember }
  | { kind: 'status'; member: TeamMember; to: 'ACTIVE' | 'SUSPENDED' | 'DISABLED' }
  | { kind: 'revoke'; member: TeamMember }
  | { kind: 'reset'; member: TeamMember };

type Filter = 'all' | 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

const linkButton = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-mo-brand hover:bg-mo-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mo-brand/40';

export function TeamView() {
  const { canManageTeam, refresh } = useCoop();
  const toast = useToast();
  const params = useSearchParams();
  const team = useResource(listTeam, []);
  useReloadOn(['team'], team.reload);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  // ?new=1 opens the add form; ?new=collector opens it with the Collector role chosen (quick action "Add collector").
  useEffect(() => {
    const wanted = params.get('new');
    if (wanted === '1' || wanted === 'collector') {
      if (canManageTeam) setDialog({ kind: 'add', role: wanted === 'collector' ? 'COLLECTOR' : undefined });
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [params, canManageTeam]);

  async function saved(message?: string) {
    setDialog(null);
    if (message) toast(message);
    await Promise.all([team.reload(), refresh()]);
  }

  async function resend(m: TeamMember) {
    setBusyId(m.id);
    try {
      const result = await resendActivation(m.id);
      const outcome = smsOutcomeMessage(result.activation_sms);
      toast(outcome.ok ? `New activation link sent to ${maskPhone(m.phone_number)}.` : outcome.text);
      await team.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send the link.');
    } finally {
      setBusyId(null);
    }
  }

  const members = team.data ?? [];
  const shown = filter === 'all' ? members : members.filter((m) => accountState(m) === filter);
  const pending = members.filter((m) => accountState(m) === 'PENDING_ACTIVATION').length;

  return (
    <>
      <PageHeader
        title="Team"
        subtitle={canManageTeam
          ? 'The managers and collectors who work for your cooperative. New members activate their own account from an SMS link.'
          : 'The people who work for your cooperative. Only the administrator can change the team.'}
        action={
          canManageTeam && (
            <button onClick={() => setDialog({ kind: 'add' })} className={primaryButton}>
              <Plus aria-hidden className="size-4" />
              Add team member
            </button>
          )
        }
      />

      {team.error && <div className="mb-4"><ErrorBanner message={team.error} onRetry={team.reload} /></div>}

      <div role="group" aria-label="Filter by account status" className="mb-3 flex flex-wrap gap-2">
        {([['all', 'All'], ['PENDING_ACTIVATION', `Pending activation${pending ? ` (${pending})` : ''}`], ['ACTIVE', 'Active'], ['SUSPENDED', 'Suspended'], ['DISABLED', 'Disabled']] as [Filter, string][]).map(([value, label]) => (
          <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value}
            className={`rounded-full border px-3 py-1 text-sm ${filter === value ? 'border-mo-brand bg-mo-brand-soft font-semibold text-mo-brand' : 'border-mo-line bg-white text-mo-muted hover:bg-mo-hover'}`}>
            {label}
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-xl border border-mo-line bg-white">
        {team.loading && !team.data ? (
          <LoadingRows />
        ) : shown.length === 0 ? (
          <EmptyState title="No team members" body={filter === 'all' ? 'Team members you add will appear here.' : 'Nobody matches this filter.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <caption className="sr-only">Team members and their account status</caption>
              <thead className="border-b border-mo-hover text-xs uppercase tracking-wide text-mo-subtle">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Name</th>
                  <th scope="col" className="px-3 py-3 font-medium">Role</th>
                  <th scope="col" className="px-3 py-3 font-medium">Phone</th>
                  <th scope="col" className="px-3 py-3 font-medium">Account</th>
                  <th scope="col" className="px-3 py-3 font-medium">Last sign-in</th>
                  {canManageTeam && <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-mo-hover">
                {shown.map((m) => {
                  const state = accountState(m);
                  const manageable = canManageTeam && m.role !== 'COOP_ADMIN' && !m.is_you;
                  return (
                    <tr key={m.id} className={state === 'DISABLED' ? 'text-mo-subtle' : ''}>
                      <td className="px-5 py-3.5">
                        <span className="font-medium text-mo-ink">{m.full_name}</span>
                        {m.is_you && <span className="ml-2 rounded-full bg-mo-hover px-2 py-0.5 text-xs font-medium text-mo-muted">You</span>}
                        {m.email && <span className="block text-xs text-mo-muted">{m.email}</span>}
                      </td>
                      <td className="px-3 py-3.5">{ROLE_LABEL[m.role] ?? m.role}</td>
                      <td className="whitespace-nowrap px-3 py-3.5">
                        <span className="block tabular-nums">{formatPhone(m.phone_number)}</span>
                        <PhoneVerified verified={m.phone_verified} />
                      </td>
                      <td className="px-3 py-3.5">
                        <AccountStatusBadge state={state} />
                        {state === 'PENDING_ACTIVATION' && <ActivationLine activation={m.activation} />}
                        {(state === 'SUSPENDED' || state === 'DISABLED') && m.status_reason && <span className="block text-xs text-mo-muted">{m.status_reason}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-mo-muted">{m.last_login_at ? formatDateTime(m.last_login_at) : 'Never'}</td>
                      {canManageTeam && (
                        <td className="whitespace-nowrap px-5 py-3.5 text-right">
                          {manageable && (
                            <span className="inline-flex flex-wrap justify-end gap-1">
                              <button onClick={() => setDialog({ kind: 'edit', member: m })} className={linkButton} aria-label={`Edit ${m.full_name}`}>
                                <Pencil aria-hidden className="size-3.5" /> Edit
                              </button>
                              {state === 'PENDING_ACTIVATION' && (
                                <>
                                  <button onClick={() => void resend(m)} disabled={busyId === m.id} className={linkButton} aria-label={`Resend activation link to ${m.full_name}`}>
                                    <Send aria-hidden className="size-3.5" /> {busyId === m.id ? 'Sending…' : 'Resend link'}
                                  </button>
                                  <button onClick={() => setDialog({ kind: 'revoke', member: m })} className={`${linkButton} text-mo-danger`}>Revoke</button>
                                </>
                              )}
                              {state === 'ACTIVE' && (
                                <>
                                  <button onClick={() => setDialog({ kind: 'reset', member: m })} className={linkButton} aria-label={`Send a password reset link to ${m.full_name}`}>
                                    <KeyRound aria-hidden className="size-3.5" /> Reset link
                                  </button>
                                  <button onClick={() => setDialog({ kind: 'status', member: m, to: 'SUSPENDED' })} className={`${linkButton} text-mo-danger`}>Suspend</button>
                                </>
                              )}
                              {(state === 'SUSPENDED' || state === 'DISABLED') && (
                                <button onClick={() => setDialog({ kind: 'status', member: m, to: 'ACTIVE' })} className={linkButton}>Reactivate</button>
                              )}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog?.kind === 'add' && <AddMember initialRole={dialog.role} onClose={() => setDialog(null)} onDone={() => Promise.all([team.reload(), refresh()]).then(() => undefined)} />}
      {dialog?.kind === 'edit' && (
        <EditMember
          member={dialog.member}
          onClose={() => setDialog(null)}
          onSaved={saved}
          onDisable={() => setDialog({ kind: 'status', member: dialog.member, to: 'DISABLED' })}
        />
      )}
      {dialog?.kind === 'status' && <ChangeStatus member={dialog.member} to={dialog.to} onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog?.kind === 'revoke' && <RevokeInvitation member={dialog.member} onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog?.kind === 'reset' && <SendReset member={dialog.member} onClose={() => setDialog(null)} />}
    </>
  );
}

function AddMember({ initialRole, onClose, onDone }: { initialRole?: TeamRole; onClose: () => void; onDone: () => Promise<void> }) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const { overview } = useCoop();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<TeamRole>(initialRole ?? 'COLLECTOR');
  const [step, setStep] = useState<'form' | 'review' | 'done'>('form');
  const [created, setCreated] = useState<TeamMember | null>(null);

  async function create() {
    const ok = await run(async () => {
      setCreated(await createMember({ full_name: fullName.trim(), email: email.trim() || null, phone, role }));
    });
    if (ok) {
      setStep('done');
      await onDone().catch(() => undefined);
    } else {
      setStep('form');
    }
  }

  function review(e: FormEvent) {
    e.preventDefault();
    setStep('review');
  }

  const outcome = smsOutcomeMessage(created?.activation_sms);
  return (
    <Modal title={step === 'done' ? 'Team member added' : step === 'review' ? 'Check the details' : 'Add team member'} onClose={onClose}>
      {step === 'done' && created ? (
        <div className="space-y-4">
          <p className="text-sm">
            <strong>{created.full_name}</strong> has been added as {ROLE_LABEL[created.role]?.toLowerCase()} and is <strong>waiting for activation</strong>.
            They choose their own password from the link we texted to <span className="font-mono">{maskPhone(created.phone_number)}</span>.
          </p>
          <div role="status" className={`rounded-lg border px-3 py-2.5 text-sm ${outcome.ok ? 'border-mo-brand/20 bg-mo-brand-soft text-mo-brand' : 'border-mo-danger-line bg-mo-danger-soft text-mo-danger'}`}>
            {outcome.text}
          </div>
          <div className="flex justify-end"><button type="button" onClick={onClose} className={primaryButton}>Done</button></div>
        </div>
      ) : step === 'review' ? (
        <div className="space-y-4">
          <dl className="space-y-2 rounded-lg bg-mo-canvas p-4 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-mo-muted">User</dt><dd className="font-medium">{fullName.trim()}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-mo-muted">Role</dt><dd className="font-medium">{ROLE_LABEL[role]}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-mo-muted">Phone</dt><dd className="font-mono font-medium">{maskPhone(phone) || phone}</dd></div>
            {email.trim() && <div className="flex justify-between gap-4"><dt className="text-mo-muted">Email</dt><dd className="font-medium">{email.trim()}</dd></div>}
            <div className="flex justify-between gap-4"><dt className="text-mo-muted">Cooperative</dt><dd className="font-medium">{overview.cooperative.name}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-mo-muted">Activation</dt><dd className="font-medium">SMS activation link will be sent</dd></div>
          </dl>
          <p className="text-sm text-mo-muted">Sending the link uses one SMS credit. No password is created here: only they will know it.</p>
          {formError && <ErrorBanner message={formError} />}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setStep('form')} className={secondaryButton}>Back</button>
            <button type="button" onClick={() => void create()} disabled={busy} className={primaryButton}>{busy && <Spinner />}<MessageSquareText aria-hidden className="size-4" />Create and send link</button>
          </div>
        </div>
      ) : (
        <form onSubmit={review} className="space-y-4" noValidate>
          <Field label="Full name" required error={fieldErrors.full_name}>
            {(p) => <input {...p} className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus maxLength={255} autoComplete="off" />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" required error={fieldErrors.phone} hint="Activation SMS will be sent to this phone number.">
              {(p) => <input {...p} className={inputClass} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" autoComplete="off" />}
            </Field>
            <Field label={role === 'MANAGER' ? 'Email' : 'Email (optional)'} required={role === 'MANAGER'} error={fieldErrors.email}
              hint={role === 'MANAGER' ? 'Managers can sign in with email or phone.' : 'Collectors can sign in with their phone number.'}>
              {(p) => <input {...p} className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}
            </Field>
          </div>
          <Field label="Role" required error={fieldErrors.role} hint={role === 'MANAGER' ? 'Managers can view everything and manage farmers and centres.' : 'Collectors record milk at your centres.'}>
            {(p) => (
              <select {...p} className={inputClass} value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
                <option value="COLLECTOR">Collector</option>
                <option value="MANAGER">Manager</option>
              </select>
            )}
          </Field>
          {formError && <ErrorBanner message={formError} />}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
            <button type="submit" disabled={!fullName.trim() || !phone.trim() || (role === 'MANAGER' && !email.trim())} className={primaryButton}>Review</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function EditMember({
  member,
  onClose,
  onSaved,
  onDisable,
}: {
  member: TeamMember;
  onClose: () => void;
  onSaved: (message?: string) => Promise<void>;
  onDisable: () => void;
}) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [fullName, setFullName] = useState(member.full_name);
  const [phone, setPhone] = useState(formatPhone(member.phone_number));
  const [role, setRole] = useState<TeamRole>(member.role === 'MANAGER' ? 'MANAGER' : 'COLLECTOR');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(async () => void (await updateMember(member.id, { full_name: fullName, phone, role })));
    if (ok) await onSaved(`${fullName.trim()} updated.`);
  }

  const phoneChanging = phone.replace(/\D/g, '').slice(-9) !== member.phone_number.replace(/\D/g, '').slice(-9);
  return (
    <Modal title={`Edit ${member.full_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" required error={fieldErrors.full_name}>
          {(p) => <input {...p} className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus maxLength={255} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" required error={fieldErrors.phone}
            hint={phoneChanging ? 'The new number must be verified by its owner. A pending activation link is re-sent to it.' : undefined}>
            {(p) => <input {...p} className={inputClass} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
          </Field>
          <Field label="Role" error={fieldErrors.role}>
            {(p) => (
              <select {...p} className={inputClass} value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
                <option value="COLLECTOR">Collector</option>
                <option value="MANAGER">Manager</option>
              </select>
            )}
          </Field>
        </div>
        <p className="text-sm text-mo-subtle">Email: {member.email ?? 'none'}. People change their own email in their settings.</p>

        {formError && <ErrorBanner message={formError} />}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {accountState(member) !== 'DISABLED' ? (
            <button type="button" onClick={onDisable} className="text-sm font-medium text-mo-danger hover:underline">Disable account</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryButton}>{busy && <Spinner />}Save changes</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function ChangeStatus({ member, to, onClose, onSaved }: {
  member: TeamMember; to: 'ACTIVE' | 'SUSPENDED' | 'DISABLED'; onClose: () => void; onSaved: (message?: string) => Promise<void>;
}) {
  const { busy, formError, run } = useSubmit();
  const [reason, setReason] = useState('');
  const verb = to === 'ACTIVE' ? 'Reactivate' : to === 'SUSPENDED' ? 'Suspend' : 'Disable';

  async function confirm() {
    const ok = await run(async () => void (await setAccountStatus(member.id, to, reason.trim() || undefined)));
    if (ok) await onSaved(`${member.full_name} ${to === 'ACTIVE' ? 'reactivated' : to === 'SUSPENDED' ? 'suspended' : 'disabled'}.`);
  }

  return (
    <Modal title={`${verb} ${member.full_name}?`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-mo-ink">
          {to === 'ACTIVE'
            ? 'They can sign in again. If they never activated their account, a new activation link is sent instead.'
            : 'They are signed out everywhere immediately and can’t sign in until reactivated. Their records stay.'}
        </p>
        {to !== 'ACTIVE' && (
          <Field label="Reason (recorded in the audit log)">
            {(p) => <input {...p} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
          </Field>
        )}
        {formError && <ErrorBanner message={formError} />}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
          <button type="button" onClick={() => void confirm()} disabled={busy}
            className={to === 'ACTIVE' ? primaryButton : 'inline-flex items-center gap-1.5 rounded-lg bg-mo-danger px-3.5 py-2 text-sm font-medium text-white hover:bg-mo-danger/90 disabled:opacity-60'}>
            {busy && <Spinner />}{verb}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RevokeInvitation({ member, onClose, onSaved }: { member: TeamMember; onClose: () => void; onSaved: (message?: string) => Promise<void> }) {
  const { busy, formError, run } = useSubmit();
  async function confirm() {
    const ok = await run(async () => void (await revokeInvitation(member.id)));
    if (ok) await onSaved(`Invitation for ${member.full_name} revoked.`);
  }
  return (
    <ConfirmModal
      title={`Revoke ${member.full_name}'s invitation?`}
      body="Their activation link stops working and the account is disabled. You can reactivate it later to send a new link."
      confirmLabel="Revoke invitation"
      danger
      busy={busy}
      error={formError}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}

function SendReset({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const { busy, formError, run } = useSubmit();
  const [result, setResult] = useState<{ sms_sent: boolean; sms_status: string; sms_error: string | null } | null>(null);
  async function confirm() {
    await run(async () => setResult(await sendPasswordReset(member.id)));
  }
  return (
    <Modal title={`Password reset for ${member.full_name}`} onClose={onClose}>
      {result ? (
        <div className="space-y-4">
          <p role="status" className={`rounded-lg border px-3 py-2.5 text-sm ${result.sms_sent ? 'border-mo-brand/20 bg-mo-brand-soft text-mo-brand' : 'border-mo-danger-line bg-mo-danger-soft text-mo-danger'}`}>
            {result.sms_sent
              ? `A reset link was sent to ${maskPhone(member.phone_number)}. They choose the new password themselves.`
              : `The reset link could not be sent${result.sms_error ? `: ${result.sms_error}` : ''}.`}
          </p>
          <div className="flex justify-end"><button onClick={onClose} className={primaryButton}>Done</button></div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">We&apos;ll text a one-time reset link to <span className="font-mono">{maskPhone(member.phone_number)}</span>. You won&apos;t see or set their password. Their current password keeps working until they use the link.</p>
          {formError && <ErrorBanner message={formError} />}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className={secondaryButton}>Cancel</button>
            <button onClick={() => void confirm()} disabled={busy} className={primaryButton}>{busy && <Spinner />}Send reset link</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
