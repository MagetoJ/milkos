import { DecisionQueue } from '../_components/decision-queue';

export default function OnboardingPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
        <p className="mt-1 text-[#5E6B64]">Review cooperatives that have applied to join Milkflow.</p>
      </header>
      <DecisionQueue
        kind="application"
        title="Applications"
        description="Oldest first. Call or email the applicant from the review panel if details look wrong."
      />
    </div>
  );
}
