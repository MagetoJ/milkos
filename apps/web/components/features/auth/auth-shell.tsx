import type { ReactNode } from 'react';
import Link from 'next/link';
import { Milk } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface AuthShellProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** Centered card layout shared by every sign-in / recovery / MFA screen. Mobile-first (320px+). */
export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-4 py-10 sm:justify-center">
      <Link href="/" className="mb-6 flex items-center gap-2 text-base font-semibold text-foreground">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Milk className="size-5" />
        </span>
        MaziwaCollect
      </Link>
      <Card className="w-full max-w-[420px]">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-5">{children}</CardContent>
      </Card>
      {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
    </div>
  );
}
