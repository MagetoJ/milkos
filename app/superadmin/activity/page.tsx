import { ActivityFeed } from '../_components/activity-feed';

export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Activity log</h1>
        <p className="mt-1 text-[#5E6B64]">Every approval and rejection, who made it, and when.</p>
      </header>
      <section className="rounded-xl border border-[#DDE3DE] bg-white">
        <ActivityFeed limit={100} detailed />
      </section>
    </div>
  );
}
