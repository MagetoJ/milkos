// The weight readout: very large, with connection, stability, scale name and battery spelled out in words
// (each with an icon, never colour alone). A typed-in weight is always labelled MANUAL ENTRY.
import { BatteryMedium, CheckCircle2, CircleDashed, Keyboard, Link2, Link2Off, Scale } from 'lucide-react';
import type { ScaleStatus } from '@/lib/scale/types';

export function formatWeight(kg: number | null | undefined): string {
  return (kg ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Chip({ tone, icon, children }: { tone: 'green' | 'amber' | 'grey' | 'blue'; icon: React.ReactNode; children: React.ReactNode }) {
  const tones = {
    green: 'bg-[#E3F1E9] text-[#176044]',
    amber: 'bg-[#FBF1DC] text-[#8A5A0B]',
    grey: 'bg-[#EEF1EC] text-[#3C4A43]',
    blue: 'bg-[#E6EEF8] text-[#1F4E86]',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{icon}{children}</span>;
}

export function ScaleDisplay({
  kg,
  stable,
  status,
  manual = false,
  label = 'TOTAL WEIGHT',
}: {
  kg: number | null;
  stable: boolean;
  status: ScaleStatus | null;
  manual?: boolean;
  label?: string;
}) {
  const connected = status?.state === 'connected';
  return (
    <section aria-label="Scale reading" className="rounded-2xl border border-[#DDE3DE] bg-white p-5 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#5E6B64]">{label}</p>
      <p className="mt-2 font-mono text-6xl font-bold tabular-nums tracking-tight text-[#17221D]" aria-live="polite" aria-atomic="true">
        {formatWeight(kg)}
        <span className="ml-2 align-middle text-2xl font-semibold text-[#5E6B64]">KG</span>
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {manual ? (
          <Chip tone="amber" icon={<Keyboard aria-hidden className="size-3.5" />}>MANUAL ENTRY · not from a scale</Chip>
        ) : (
          <>
            <Chip tone={connected ? 'green' : 'grey'} icon={connected ? <Link2 aria-hidden className="size-3.5" /> : <Link2Off aria-hidden className="size-3.5" />}>
              {connected ? 'Connected' : status?.state === 'connecting' ? 'Connecting…' : 'Disconnected'}
            </Chip>
            {connected && (
              <Chip tone={stable ? 'green' : 'amber'} icon={stable ? <CheckCircle2 aria-hidden className="size-3.5" /> : <CircleDashed aria-hidden className="size-3.5 animate-spin" />}>
                {stable ? 'Stable' : 'Unstable — wait'}
              </Chip>
            )}
            {status?.deviceName && (
              <Chip tone={status.transport === 'SIMULATED' ? 'blue' : 'grey'} icon={<Scale aria-hidden className="size-3.5" />}>
                {status.deviceName}
              </Chip>
            )}
            {status?.capabilities.battery && status.batteryPercent != null && (
              <Chip tone={status.batteryPercent < 20 ? 'amber' : 'grey'} icon={<BatteryMedium aria-hidden className="size-3.5" />}>
                Battery {status.batteryPercent}%
              </Chip>
            )}
          </>
        )}
      </div>
    </section>
  );
}
