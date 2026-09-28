import { AuthCard } from '../_components/auth-card';
import { RegisterForm } from '../_components/register-form';

export default function RegisterPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <AuthCard title="Create Account" subtitle="Register a new farmer or collector account">
        <RegisterForm />
      </AuthCard>
    </main>
  );
}