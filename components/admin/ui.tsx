'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, CircleAlert, Loader2, X } from 'lucide-react';

export const inputClass =
  'w-full rounded-lg border border-mo-line-strong bg-white px-3 py-2 text-sm text-mo-ink outline-none placeholder:text-mo-subtle ' +
  'focus:border-mo-brand focus:ring-2 focus:ring-mo-brand/20 disabled:bg-[#F3F5F2] disabled:text-mo-subtle aria-[invalid=true]:border-mo-danger';

export const primaryButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-mo-brand px-3.5 py-2 text-sm font-medium text-white outline-none ' +
  'hover:bg-mo-brand-strong focus-visible:ring-2 focus-visible:ring-mo-brand/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

export const secondaryButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-mo-line-strong bg-white px-3.5 py-2 text-sm font-medium text-mo-ink outline-none ' +
  'hover:bg-mo-hover focus-visible:ring-2 focus-visible:ring-mo-brand/40 disabled:cursor-not-allowed disabled:opacity-60';

export const dangerButton =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-mo-danger-line bg-white px-3.5 py-2 text-sm font-medium text-mo-danger outline-none ' +
  'hover:bg-mo-danger-soft focus-visible:ring-2 focus-visible:ring-mo-danger/30 disabled:cursor-not-allowed disabled:opacity-60';

export function PageHeader({
  title,
  subtitle,
  action,
  back,
  badge,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** A link shown above the title, e.g. back to the list this page belongs to. */
  back?: { href: string; label: string };
  badge?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-mo-brand hover:underline">
            <ChevronLeft className="size-4" aria-hidden />
            {back.label}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="mt-1 text-mo-muted">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}

export function StatusPill({ active, activeLabel = 'Active', inactiveLabel = 'Inactive' }: { active: boolean; activeLabel?: string; inactiveLabel?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        active ? 'bg-mo-brand-soft text-mo-brand' : 'bg-mo-hover text-mo-muted'
      }`}
    >
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-mo-danger-line bg-mo-danger-soft px-4 py-3 text-sm text-[#912018]">
      <span className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        {message}
      </span>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="divide-y divide-mo-hover">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="h-3.5 w-1/4 animate-pulse rounded bg-mo-hover" />
          <div className="h-3.5 w-1/3 animate-pulse rounded bg-mo-hover" />
          <div className="ml-auto h-3.5 w-16 animate-pulse rounded bg-mo-hover" />
        </div>
      ))}
    </div>
  );
}

export function Spinner() {
  return <Loader2 className="size-4 animate-spin" aria-hidden />;
}

export function Field({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="text-mo-danger"> *</span>}
      </label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': error || hint ? noteId : undefined })}
      {error ? (
        <p id={noteId} role="alert" className="mt-1 text-xs text-mo-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={noteId} className="mt-1 text-xs text-mo-subtle">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Focus moves into the dialog, Tab stays inside it, Escape closes, and focus returns where it was.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(panel.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
    const first = focusables().find((el) => el.getAttribute('aria-label') !== 'Close') ?? focusables()[0];
    if (!panel.current?.contains(document.activeElement)) (first ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return closeRef.current();
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}
      >
        <div className="flex items-center justify-between border-b border-mo-hover px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-mo-muted hover:bg-mo-hover">
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm text-[#394640]">{body}</div>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className={danger ? dangerButton : primaryButton}>
            {busy && <Spinner />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}