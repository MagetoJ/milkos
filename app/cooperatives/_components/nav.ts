// The cooperative workspace menu (spec section 6): Overview, Operations, Finance, Reporting, Management, Governance.
// Items are filtered by what the signed-in role may do; the server still enforces every action.
import {
  Banknote, Bell, ClipboardCheck, FileBarChart, Gauge, LayoutDashboard, MapPin, MessageSquareText, Milk, RefreshCw, Settings, Smartphone, Snowflake,
  Tags, UserCog, Users, type LucideIcon,
} from 'lucide-react';
import { canAny } from '@/lib/permissions';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: number;
  /** Shown only to roles holding at least one of these permissions. */
  permission?: string | string[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface NavInput {
  role: string;
  offlineCapable: boolean;
  unread: number;
  activeFarmers: number;
  operationalCoolers: number;
  activeCentres: number;
  pendingPayments?: number;
  pendingCorrections?: number;
}

export function coopNav(i: NavInput): NavGroup[] {
  const groups: NavGroup[] = [
    {
      title: 'Overview',
      items: [
        { href: '/cooperatives', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/cooperatives/notifications', label: 'Notifications', icon: Bell, count: i.unread || undefined },
      ],
    },
    {
      title: 'Operations',
      items: [
        { href: '/collections', label: 'Milk collections', icon: Milk, permission: 'collection.read' },
        { href: '/collector', label: 'Collector app', icon: Smartphone, permission: 'collection.create' },
        { href: '/cooperatives/farmers', label: 'Farmers', icon: Users, count: i.activeFarmers, permission: 'farmer.read' },
        { href: '/cooperatives/operations', label: 'Coolers & collectors', icon: Snowflake, count: i.operationalCoolers, permission: 'cooler.read' },
        { href: '/cooperatives/centres', label: 'Collection centres', icon: MapPin, count: i.activeCentres, permission: 'farmer.read' },
        { href: '/cooperatives/coolers', label: 'Cooler monitoring', icon: Gauge, permission: 'cooler.read' },
        ...(i.offlineCapable ? [{ href: '/cooperatives/sync', label: 'Sync center', icon: RefreshCw }] : []),
      ],
    },
    {
      title: 'Finance',
      items: [
        { href: '/cooperatives/pricing', label: 'Milk pricing', icon: Tags, permission: 'pricing.read' },
        { href: '/cooperatives/sms-credits', label: 'SMS credits', icon: MessageSquareText, permission: 'sms_credit.read' },
        { href: '/cooperatives/payments', label: 'Farmer payments', icon: Banknote, count: i.pendingPayments || undefined, permission: 'farmer_payment.read' },
      ],
    },
    { title: 'Reporting', items: [{ href: '/cooperatives/reports', label: 'Reports', icon: FileBarChart, permission: 'report.read' }] },
    {
      title: 'Management',
      items: [
        { href: '/cooperatives/team', label: 'Team', icon: UserCog, permission: 'user.read' },
        { href: '/cooperatives/settings', label: i.role === 'COOP_ADMIN' ? 'Settings' : 'My settings', icon: Settings },
      ],
    },
    {
      title: 'Governance',
      items: [{
        href: '/cooperatives/corrections', label: 'Corrections & reversals', icon: ClipboardCheck,
        count: i.pendingCorrections || undefined, permission: 'collection.correction.request',
      }],
    },
  ];
  return groups
    .map((g) => ({ ...g, items: g.items.filter((item) => canAny(i.role, item.permission)) }))
    .filter((g) => g.items.length > 0);
}
