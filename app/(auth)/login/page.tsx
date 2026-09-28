import { AuthCard } from '../_components/auth-card';
import { LoginForm } from '../_components/login-form';

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <AuthCard title="Milkflow Portal" subtitle="Sign in to your account">
        <LoginForm />
      </AuthCard>
    </main>
  );
}