import * as React from 'react';
import { cn } from '@/lib/utils';

/** Horizontal rule; with children it renders a labelled divider ("or"). */
function Separator({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  if (!children) return <div role="separator" className={cn('h-px w-full shrink-0 bg-border', className)} {...props} />;
  return (
    <div role="separator" className={cn('flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground', className)} {...props}>
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export { Separator };
