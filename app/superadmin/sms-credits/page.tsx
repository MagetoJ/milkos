import { DecisionQueue } from '../_components/decision-queue';

export default function SmsCreditsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">SMS credits</h1>
        <p className="mt-1 text-[#5E6B64]">Match each M-Pesa payment against the paybill statement before issuing credits.</p>
      </header>
      <DecisionQueue kind="payment" title="Top-ups to verify" />
    </div>
  );
}
