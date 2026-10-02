'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, Copy, KeyRound, Pencil, Plus, RefreshCw } from 'lucide-react';
import { useToast } from '@/app/superadmin/_components/toast';
import { createMember, listTeam, updateMember } from '../_api/coop-client';
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
  StatusPill,
  inputClass,
  primaryButton,
  secondaryButton,
} from './ui';

const ROLE_LABEL: Record<TeamMember['role'], string> = {
  COOP_ADMIN: 'Administrator',
  MANAGER: 'Manager',
  COLLECTOR: 'Collector',
};

/** 12 characters with at least one capital and one digit (the API's rules); no look-alike characters. */
function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const random = (max: number) => crypto.getRandomValues(new Uint32Array(1))[0] % max;
  const pick = (set: string) => set[random(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), ...Array.from({ length: 9 }, () => pick(upper + lower + digits))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; member: TeamMember }
  | { kind: 'reset'; member: TeamMember }
  | { kind: 'status'; member: TeamMember };

export function TeamView() {
  const { canManageTeam, refresh } = useCoop();
  const toast = useToast();
  const params = useSearchParams();
  const team = useResource(listTeam, []);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  useEffect(() => {
    if (params.get('new') === '1') {
      if (canManageTeam) setDialog({ kind: 'add' });
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [params, canManageTeam]);

  async function saved(message?: string) {
    setDialog(null);
    if (message) toast(message);
    await Promise.all([team.reload(), refresh()]);
  }

  // Add and password-reset keep their dialog open to show the sign-in details, so they only refresh.
  async function reloadOnly() {
    await Promise.all([team.reload(), refresh()]);
  }

  const members = team.data ?? [];

  return (
    <>
      <PageHeader
        title="Team"
        subtitle={canManageTeam ? 'The managers and collectors who work for your cooperative.' : 'The people who work for your cooperative. Only the administrator can change the team.'}
        action={
          canManageTeam && (
            <button onClick={() => setDialog({ kind: 'add' })} className={primaryButton}>
              <Plus className="size-4" />
              Add team member
            </button>
          )
        }
      />

      {team.error && <div className="mb-4"><ErrorBanner message={team.error} onRetry={team.reload} /></div>}

      <section className="overflow-hidden rounded-xl border border-[#DDE3DE] bg-white">
        {team.loading && !team.data ? (
          <LoadingRows />
        ) : members.length === 0 ? (
          <EmptyState title="No team members" body="Team members you add will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[#EEF1EC] text-xs uppercase tracking-wide text-[#8A968F]">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Role</th>
                  <th className="px-3 py-3 font-medium">Email</th>
                  <th className="px-3 py-3 font-medium">Phone</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  {canManageTeam && <th className="px-5 py-3"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1EC]">
                {members.map((m) => (
                  <tr key={m.id} className={m.is_active ? '' : 'text-[#8A968F]'}>
                    <td className="px-5 py-3.5 font-medium text-[#17221D]">
                      {m.full_name}
                      {m.is_you && <span className="ml-2 rounded-full bg-[#EEF1EC] px-2 py-0.5 text-xs font-medium text-[#5E6B64]">You</span>}
                    </td>
                    <td className="px-3 py-3.5">{ROLE_LABEL[m.role]}</td>
                    <td className="px-3 py-3.5">{m.email}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 tabular-nums">{formatPhone(m.phone_number)}</td>
                    <td className="px-3 py-3.5"><StatusPill active={m.is_active} /></td>
                    {canManageTeam && (
                      <td className="whitespace-nowrap px-5 py-3.5 text-right">
                        {m.role !== 'COOP_ADMIN' && (
                          <>
                            <button onClick={() => setDialog({ kind: 'edit', member: m })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-[#176044] hover:bg-[#EEF1EC]" aria-label={`Edit ${m.full_name}`}>
                              <Pencil className="size-3.5" /> Edit
                            </button>
                            <button onClick={() => setDialog({ kind: 'reset', member: m })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-[#176044] hover:bg-[#EEF1EC]" aria-label={`Reset password for ${m.full_name}`}>
                              <KeyRound className="size-3.5" /> Password
                            </button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog?.kind === 'add' && <AddMember onClose={() => setDialog(null)} onDone={reloadOnly} />}
      {dialog?.kind === 'edit' && (
        <EditMember
          member={dialog.member}
          onClose={() => setDialog(null)}
          onSaved={saved}
          onToggle={() => setDialog({ kind: 'status', member: dialog.member })}
        />
      )}
      {dialog?.kind === 'reset' && <ResetPassword member={dialog.member} onClose={() => setDialog(null)} onSaved={reloadOnly} />}
      {dialog?.kind === 'status' && <ToggleStatus member={dialog.member} onClose={() => setDialog(null)} onSaved={saved} />}
    </>
  );
}

function PasswordField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <Field label="Password" required error={error} hint="At least 8 characters with a capital letter and a digit.">
      {(p) => (
        <div className="flex gap-2">
          <input {...p} className={`${inputClass} font-mono`} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" spellCheck={false} maxLength={64} />
          <button type="button" onClick={() => onChange(generatePassword())} className={`${secondaryButton} shrink-0`}>
            <RefreshCw className="size-3.5" /> Generate
          </button>
        </div>
      )}
    </Field>
  );
}

function Credentials({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Milkflow sign-in\nEmail: ${email}\nPassword: ${password}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* clipboard blocked: the details are on screen to copy by hand */
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#394640]">Share these sign-in details with them. For security the password can’t be shown again, but you can set a new one any time.</p>
      <dl className="space-y-2 rounded-lg bg-[#F6F7F4] p-4 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-[#5E6B64]">Email</dt><dd className="font-medium">{email}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-[#5E6B64]">Password</dt><dd className="font-mono font-medium">{password}</dd></div>
      </dl>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={copy} className={secondaryButton}>
          {copied ? <Check className="size-4 text-[#176044]" /> : <Copy className="size-4" />}
          {copied ? 'Copied' : 'Copy details'}
        </button>
        <button type="button" onClick={onClose} className={primaryButton}>Done</button>
      </div>
    </div>
  );
}

function AddMember({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<TeamRole>('COLLECTOR');
  const [password, setPassword] = useState(() => generatePassword());
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(async () => {
      const member = await createMember({ full_name: fullName, email, phone, role, password });
      setCreated({ email: member.email, password });
    });
    if (ok) await onDone().catch(() => undefined);
  }

  return (
    <Modal title={created ? 'Team member added' : 'Add team member'} onClose={onClose}>
      {created ? (
        <Credentials email={created.email} password={created.password} onClose={onClose} />
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Full name" required error={fieldErrors.full_name}>
            {(p) => <input {...p} className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus maxLength={255} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" required error={fieldErrors.email} hint="They sign in with this.">
              {(p) => <input {...p} className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}
            </Field>
            <Field label="Phone" required error={fieldErrors.phone}>
              {(p) => <input {...p} className={inputClass} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />}
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
          <PasswordField value={password} onChange={setPassword} error={fieldErrors.password} />

          {formError && <ErrorBanner message={formError} />}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryButton}>{busy && <Spinner />}Add member</button>
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
  onToggle,
}: {
  member: TeamMember;
  onClose: () => void;
  onSaved: (message?: string) => Promise<void>;
  onToggle: () => void;
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

  return (
    <Modal title={`Edit ${member.full_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" required error={fieldErrors.full_name}>
          {(p) => <input {...p} className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus maxLength={255} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" required error={fieldErrors.phone}>
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
        <p className="text-xs text-[#8A968F]">Email: {member.email}. It can’t be changed here.</p>

        {formError && <ErrorBanner message={formError} />}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button type="button" onClick={onToggle} className={`text-sm font-medium hover:underline ${member.is_active ? 'text-[#B42318]' : 'text-[#176044]'}`}>
            {member.is_active ? 'Deactivate account' : 'Reactivate account'}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryButton}>{busy && <Spinner />}Save changes</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function ResetPassword({ member, onClose, onSaved }: { member: TeamMember; onClose: () => void; onSaved: () => Promise<void> }) {
  const { busy, fieldErrors, formError, run } = useSubmit();
  const [password, setPassword] = useState(() => generatePassword());
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(async () => void (await updateMember(member.id, { password })));
    if (ok) {
      setDone(true);
      await onSaved().catch(() => undefined);
    }
  }

  return (
    <Modal title={`New password for ${member.full_name}`} onClose={onClose}>
      {done ? (
        <Credentials email={member.email} password={password} onClose={onClose} />
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-sm text-[#394640]">Their current password stops working as soon as you save.</p>
          <PasswordField value={password} onChange={setPassword} error={fieldErrors.password} />
          {formError && <ErrorBanner message={formError} />}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryButton}>{busy && <Spinner />}Set password</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ToggleStatus({ member, onClose, onSaved }: { member: TeamMember; onClose: () => void; onSaved: (message?: string) => Promise<void> }) {
  const { busy, formError, run } = useSubmit();
  const deactivating = member.is_active;

  async function confirm() {
    const ok = await run(async () => void (await updateMember(member.id, { is_active: !deactivating })));
    if (ok) await onSaved(`${member.full_name} ${deactivating ? 'deactivated' : 'reactivated'}.`);
  }

  return (
    <ConfirmModal
      title={`${deactivating ? 'Deactivate' : 'Reactivate'} ${member.full_name}?`}
      body={
        deactivating
          ? 'They will be signed out and won’t be able to sign in again until you reactivate them. Their records stay.'
          : 'They will be able to sign in again with their current password.'
      }
      confirmLabel={deactivating ? 'Deactivate' : 'Reactivate'}
      danger={deactivating}
      busy={busy}
      error={formError}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}