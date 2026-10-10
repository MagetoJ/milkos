'use client';

// Manager quick actions (spec section 17): New Farmer, Add Collector, Add Cooler, Set Monthly Price, Buy SMS Credits.
// Each one links to the screen that owns the form and opens it (?new=). Shown only to roles allowed to do it.
import Link from 'next/link';
import { MessageSquarePlus, Snowflake, Tags, Truck, UserPlus, type LucideIcon } from 'lucide-react';
import { canAny } from '@/lib/permissions';

export interface QuickAction {
  label: string;
  href: string;
  icon: LucideIcon;
  permission: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { label: 'New farmer', href: '/cooperatives/farmers?new=1', icon: UserPlus, permission: 'farmer.create' },
  { label: 'Add collector', href: '/cooperatives/team?new=collector', icon: Truck, permission: 'collector.create' },
  { label: 'Add cooler', href: '/cooperatives/operations?new=1', icon: Snowflake, permission: 'cooler.create' },
  { label: 'Set monthly price', href: '/cooperatives/pricing?new=1', icon: Tags, permission: 'pricing.manage' },
  { label: 'Buy SMS credits', href: '/cooperatives/sms-credits?new=1', icon: MessageSquarePlus, permission: 'sms_credit.purchase' },
];

export function quickActionsFor(role: string): QuickAction[] {
  return QUICK_ACTIONS.filter((a) => canAny(role, a.permission));
}

export function QuickActions({ role }: { role: string }) {
  const actions = quickActionsFor(role);
  if (!actions.length) return null;
  return (
    <section aria-label="Quick actions">
      <ul className="flex flex-wrap gap-2">
        {actions.map(({ label, href, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-mo-line-strong bg-mo-surface px-3.5 text-sm font-medium text-mo-ink outline-none hover:bg-mo-hover focus-visible:ring-2 focus-visible:ring-mo-brand/40"
            >
              <Icon aria-hidden className="size-4 text-mo-brand" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
