import { Check } from 'lucide-react';
import { PublicShell } from '@/components/public/public-shell';
import { RegisterForm } from '../_components/register-form';

export const metadata = { title: 'Apply · MilkOS' };

const POINTS = [
  'Tracks every milk collection',
  'Manages your farmers',
  'Monitors your coolers',
  'Works offline at the collection centre',
  'Sends SMS receipts to farmers',
  'Manages milk pricing and reports',
];

export default function RegisterPage() {
  return (
    <PublicShell
      wide
      title="Manage milk collections with confidence."
      subtitle="Apply for your cooperative or cooler. It takes a few minutes, and we'll review it and get back to you."
      aside={
        <ul className="mt-4 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2" aria-label="What MilkOS does">
          {POINTS.map((p) => (
            <li key={p} className="flex items-start gap-2"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-mo-brand" />{p}</li>
          ))}
        </ul>
      }
    >
      <RegisterForm />
    </PublicShell>
  );
}
