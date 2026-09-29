import { AuthCard } from '../_components/auth-card';
import { RegisterForm } from '../_components/register-form';

export default function RegisterPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-black p-4 text-white">
      <AuthCard title="Create Account" subtitle="Submit a new cooperative onboarding application">
        <RegisterForm />
      </AuthCard>
    </main>
  );
}