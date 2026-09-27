import { AuthShell } from '@/components/features/auth/auth-shell';
import { ResetPasswordForm } from '@/components/features/auth/reset-password-form';

export const metadata = { title: 'Choose a password · MaziwaCollect' };

interface ResetPasswordPageProps {
  searchParams: Promise<{ invited?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const invited = (await searchParams).invited === '1';
  return (
    <AuthShell
      title={invited ? 'Welcome — set your password' : 'Choose a new password'}
      description={invited ? 'You’ve been invited to MaziwaCollect. Set a password to finish activating your account.' : 'Other devices stay signed in until their session expires.'}
    >
      <ResetPasswordForm invited={invited} />
    </AuthShell>
  );
}
