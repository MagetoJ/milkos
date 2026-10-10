'use client';

import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { ErrorBanner, LoadingRows } from './ui';

export function LoadingState({ rows = 5, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label}>
      <LoadingRows rows={rows} />
    </div>
  );
}

export function ErrorState({ message, onRetry, compact }: { message: string; onRetry?: () => void; compact?: boolean }) {
  return (
    <div className={compact ? '' : 'p-5'}>
      <ErrorBanner message={message} onRetry={onRetry} />
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="text-[#B8C4BC]" aria-hidden>
        {icon ?? <Inbox className="size-8" />}
      </span>
      <p className="mt-3 font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-sm text-sm text-mo-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
