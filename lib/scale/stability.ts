// Stable-weight detection for scales that don't report stability themselves.
//
// A weight is stable when, over the last `windowMs`, at least `minSamples` readings were taken and none
// differs from the newest by more than `toleranceKg`. Milk sloshing in a can makes a fresh load swing for a
// second or two; capturing only a stable value keeps the recorded weight honest.

export interface StabilityOptions {
  windowMs: number;
  toleranceKg: number;
  minSamples: number;
}

export const DEFAULT_STABILITY: StabilityOptions = { windowMs: 1500, toleranceKg: 0.05, minSamples: 3 };

export class StabilityDetector {
  private samples: { kg: number; at: number }[] = [];

  constructor(private options: StabilityOptions = DEFAULT_STABILITY) {}

  /** Add a reading; returns whether the weight is now stable. */
  push(kg: number, at: number): boolean {
    this.samples.push({ kg, at });
    const cutoff = at - this.options.windowMs;
    this.samples = this.samples.filter((s) => s.at >= cutoff);
    return this.isStable();
  }

  isStable(): boolean {
    if (this.samples.length < this.options.minSamples) return false;
    const latest = this.samples[this.samples.length - 1].kg;
    if (latest <= 0) return false;
    return this.samples.every((s) => Math.abs(s.kg - latest) <= this.options.toleranceKg);
  }

  reset() {
    this.samples = [];
  }
}

/** Round to the 0.01 KG the server stores (and the display shows). */
export function roundKg(kg: number): number {
  return Math.round(kg * 100) / 100;
}
