// Collector-sized building blocks: large touch targets (>= 48px), high contrast, clear labels.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const bigPrimary =
  'inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#176044] px-5 text-base font-bold text-white ' +
  'active:bg-[#124D37] disabled:cursor-not-allowed disabled:bg-[#9DB8A8]';
export const bigSecondary =
  'inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-[#C9D2CB] bg-white px-5 text-base font-bold text-[#17221D] ' +
  'active:bg-[#EEF1EC] disabled:cursor-not-allowed disabled:opacity-50';
export const mediumButton =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[#C9D2CB] bg-white px-4 text-sm font-semibold text-[#17221D] ' +
  'active:bg-[#EEF1EC] disabled:cursor-not-allowed disabled:opacity-50';
export const bigInput =
  'w-full min-h-12 rounded-xl border-2 border-[#C9D2CB] bg-white px-4 text-lg text-[#17221D] outline-none placeholder:text-[#8A968F] ' +
  'focus:border-[#176044] aria-[invalid=true]:border-[#B42318]';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[#DDE3DE] bg-white p-4 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between">
      <h2 className="text-sm font-bold uppercase tracking-wide text-[#5E6B64]">{children}</h2>
      {action}
    </div>
  );
}

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'medium' }) {
  const base = variant === 'primary' ? bigPrimary : variant === 'medium' ? mediumButton : bigSecondary;
  return <button type="button" className={`${base} ${className}`} {...props} />;
}

export function Notice({ tone = 'grey', children }: { tone?: 'grey' | 'amber' | 'red' | 'green'; children: ReactNode }) {
  const tones = {
    grey: 'border-[#DDE3DE] bg-white text-[#3C4A43]',
    amber: 'border-[#F1D9A6] bg-[#FBF1DC] text-[#5C3D06]',
    red: 'border-[#F4C7C3] bg-[#FDECEA] text-[#912018]',
    green: 'border-[#9CCFB3] bg-[#E3F1E9] text-[#124D37]',
  };
  return (
    <div role={tone === 'red' ? 'alert' : 'note'} className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}
