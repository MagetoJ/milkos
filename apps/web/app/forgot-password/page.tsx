import Link from 'next/link';
import { AuthShell } from '@/components/features/auth/auth-shell';
import { ForgotPasswordForm } from '@/components/features/auth/forgot-password-form';

export const metadata = { title: 'Reset password · MaziwaCollect' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email you sign in with and we’ll send a reset link."
      footer={<Link href="/login" className="font-medium text-primary hover:underline">Back to sign in</Link>}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
