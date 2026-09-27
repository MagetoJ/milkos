import Link from 'next/link';
import { AuthShell } from '@/components/features/auth/auth-shell';
import { SignupForm } from '@/components/features/auth/signup-form';
import { safeNext } from '@/lib/auth/redirect';

export const metadata = { title: 'Create account · MaziwaCollect' };

interface SignupPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { next } = await searchParams;
  const target = safeNext(next);
  return (
    <AuthShell
      title="Create your account"
      description="Register a cooperative or accept an invitation from your manager."
      footer={<>Already have an account? <Link href={`/login?next=${encodeURIComponent(target)}`} className="font-medium text-primary hover:underline">Sign in</Link></>}
    >
      <SignupForm next={target} />
    </AuthShell>
  );
}
