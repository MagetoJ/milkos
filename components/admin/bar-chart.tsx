'use client';

import { useState } from 'react';

export interface BarDatum {
  label: string; // short axis label
  title: string; // full label for the tooltip
  value: number;
}

/**
 * Single-series bar chart (one hue, so no legend; the heading names the series).
 * Thin bars with rounded data ends on the baseline, a recessive axis, and a tooltip per bar.
 */
export function BarChart({
  data,
  format,
  height = 160,
  ariaLabel,
}: {
  data: BarDatum[];
  format: (value: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0);
  const top = max > 0 ? max : 1;
  const everyNth = Math.ceil(data.length / 7);

  return (
    <figure aria-label={ariaLabel} className="relative">
      <div className="flex items-stretch gap-[2px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => {
          const pct = (d.value / top) * 100;
          return (
            <button
              type="button"
              key={`${d.label}-${i}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${d.title}: ${format(d.value)}`}
              className="group relative flex flex-1 flex-col justify-end outline-none"
            >
              <span
                className={`mx-auto block w-full max-w-[28px] rounded-t-[4px] transition-colors ${
                  hover === i ? 'bg-mo-brand-strong' : 'bg-[#2E8B62]'
                } group-focus-visible:ring-2 group-focus-visible:ring-[#E8B04B]`}
                style={{ height: d.value > 0 ? `max(${pct}%, 2px)` : '0px' }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1 border-t border-mo-line" />
      <div className="mt-1 flex gap-[2px] text-[11px] text-mo-subtle">
        {data.map((d, i) => (
          <span key={`${d.label}-axis-${i}`} className="flex-1 text-center tabular-nums">
            {i % everyNth === 0 || i === data.length - 1 ? d.label : ''}
          </span>
        ))}
      </div>
      {hover !== null && data[hover] && (
        <div
          role="status"
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-mo-line bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
        >
          <span className="block text-mo-muted">{data[hover].title}</span>
          <span className="font-semibold tabular-nums text-mo-ink">{format(data[hover].value)}</span>
        </div>
      )}
      {max === 0 && (
        <p className="absolute inset-x-0 top-1/3 text-center text-sm text-mo-subtle">No accepted milk recorded in this period.</p>
      )}
    </figure>
  );
}
