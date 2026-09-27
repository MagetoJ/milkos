import { AuthShell } from '@/components/features/auth/auth-shell';
import { MfaPanel } from '@/components/features/auth/mfa-panel';
import { safeNext } from '@/lib/auth/redirect';

export const metadata = { title: 'Two-step verification · MaziwaCollect' };

interface MfaPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function MfaPage({ searchParams }: MfaPageProps) {
  const next = safeNext((await searchParams).next);
  return (
    <AuthShell
      title="Two-step verification"
      description="Your role manages cooperative or platform data, so an authenticator app code is required."
    >
      <MfaPanel next={next} />
    </AuthShell>
  );
}
