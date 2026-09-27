import Link from 'next/link';
import { AuthShell } from '@/components/features/auth/auth-shell';
import { LoginForm } from '@/components/features/auth/login-form';
import { safeNext } from '@/lib/auth/redirect';

export const metadata = { title: 'Sign in · MaziwaCollect' };

const ERRORS: Record<string, string> = {
  link: 'That sign-in link is invalid or has expired. Request a new one below.',
  provider: 'Google sign-in was cancelled or failed. Try again or use email.',
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next, error } = await searchParams;
  const target = safeNext(next);
  return (
    <AuthShell
      title="Sign in"
      description="Access your cooperative’s collections, farmers and payments."
      footer={<>New to MaziwaCollect? <Link href={`/signup?next=${encodeURIComponent(target)}`} className="font-medium text-primary hover:underline">Create an account</Link></>}
    >
      <LoginForm next={target} initialError={error ? ERRORS[error] : undefined} />
    </AuthShell>
  );
}
