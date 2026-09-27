'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useAuth } from './AuthProvider';

type NavItem = { label: string; href: string; permission?: string; signedIn?: boolean };

const navItems: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Register Cooperative', href: '/cooperatives/register' },
  { label: 'Track Application', href: '/applications/status' },
  { label: 'Admin Portal', href: '/admin/applications', permission: 'platform:cooperatives:read' },
  { label: 'Co-op Dashboard', href: '/dashboard', signedIn: true },
  { label: 'New Collection', href: '/collections/new', permission: 'collections:create' },
  { label: 'Coolers', href: '/coolers', permission: 'coolers:read' },
  { label: 'Pricing', href: '/pricing', permission: 'pricing:read' },
  { label: 'SMS', href: '/sms', permission: 'sms:read' },
  { label: 'Corrections', href: '/corrections', permission: 'corrections:decide' },
  { label: 'Reversals', href: '/reversals', permission: 'reversals:decide' },
  { label: 'Reports', href: '/reports', permission: 'reports:read' },
  { label: 'Payments', href: '/admin/payments', permission: 'platform:payments:verify' },
];

type CooperativeOption = { id: string; name: string };

export default function Navbar() {
  const pathname = usePathname();
  const { status, me, cooperativeId, setCooperative, can, signOut } = useAuth();
  const [platformCooperatives, setPlatformCooperatives] = useState<CooperativeOption[]>([]);

  // Platform staff can act in any cooperative, so offer the full list rather than only their memberships.
  const isPlatformStaff = Boolean(me?.user.platformRole);
  useEffect(() => {
    if (!isPlatformStaff || !me?.session.mfaSatisfied) return;
    apiFetch<CooperativeOption[]>('/admin/cooperatives').then(setPlatformCooperatives).catch(() => setPlatformCooperatives([]));
  }, [isPlatformStaff, me?.session.mfaSatisfied]);

  const options: CooperativeOption[] = [...(me?.cooperatives || [])];
  for (const c of platformCooperatives) if (!options.some((o) => o.id === c.id)) options.push(c);

  const visible = navItems.filter((item) => {
    if (item.permission) return can(item.permission);
    if (item.signedIn) return status === 'signed-in';
    return true;
  });

  return (
    <header className="navbar">
      <div className="nav-container">
        <div className="nav-brand">
          <Link href="/">🥛 MaziwaCollect</Link>
        </div>
        <nav className="nav-tabs">
          {visible.map((item) => (
            <Link key={item.href} href={item.href} className={`nav-tab ${pathname === item.href ? 'active' : ''}`}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="nav-account">
          {status === 'signed-in' && me && (
            <>
              {options.length > 0 && (
                <select
                  aria-label="Active cooperative"
                  value={cooperativeId || ''}
                  onChange={(event) => void setCooperative(event.target.value)}
                  className="nav-signout nav-select"
                >
                  {!cooperativeId && <option value="" disabled>Choose cooperative</option>}
                  {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <span>{me.user.displayName}</span>
              <button type="button" className="nav-signout" onClick={() => void signOut()}>Sign out</button>
            </>
          )}
          {status === 'signed-out' && pathname !== '/login' && (
            <Link className="nav-signin" href={`/login?next=${encodeURIComponent(pathname)}`}>Sign in</Link>
          )}
        </div>
      </div>
    </header>
  );
}
