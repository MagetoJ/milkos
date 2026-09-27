import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

export function FormField({ id, label, error, hint, action, children }: FormFieldProps) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {action}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="m-0 text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p className="m-0 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
