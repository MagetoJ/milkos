'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ErrorBanner, Modal, Spinner, dangerButton, inputClass, primaryButton, secondaryButton } from './ui';

/**
 * Asks before an important action. With `reason`, the user must explain (the text is sent to the API,
 * which records it in the audit log). Errors from `onConfirm` are shown inside the dialog.
 */
export function ConfirmationDialog({
  title,
  body,
  confirmLabel,
  danger,
  reason,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  reason?: { label: string; required?: boolean; placeholder?: string; minLength?: number };
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const min = reason?.required ? reason.minLength ?? 5 : 0;
  const ready = !reason?.required || text.trim().length >= min;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(text.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={() => !busy && onClose()}>
      <div className="space-y-4">
        <div className="text-sm text-[#394640]">{body}</div>
        {reason && (
          <div>
            <label htmlFor={id} className="mb-1 block text-sm font-medium">
              {reason.label}
              {reason.required && <span className="text-mo-danger"> *</span>}
            </label>
            <textarea
              id={id}
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={reason.placeholder}
              className={inputClass}
              autoFocus
            />
            <p className="mt-1 text-xs text-mo-subtle">
              Saved to the audit log{reason.required ? ` · at least ${min} characters` : ''}.
            </p>
          </div>
        )}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>
            Cancel
          </button>
          <button type="button" onClick={confirm} disabled={busy || !ready} className={danger ? dangerButton : primaryButton}>
            {busy && <Spinner />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** A modal form: fields as children, a submit button, and room for a form-level error. */
export function FormDialog({
  title,
  onClose,
  onSubmit,
  busy,
  error,
  submitLabel,
  children,
  wide,
  footerStart,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => unknown;
  busy: boolean;
  error?: string | null;
  submitLabel: string;
  children: ReactNode;
  wide?: boolean;
  /** e.g. a "Deactivate" link on the left of the buttons. */
  footerStart?: ReactNode;
}) {
  function submit(e: FormEvent) {
    e.preventDefault();
    void onSubmit();
  }
  return (
    <Modal title={title} onClose={() => !busy && onClose()} wide={wide}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {children}
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div>{footerStart}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy && <Spinner />}
              {submitLabel}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
