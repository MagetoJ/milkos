'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navbar() {
  const pathname = usePathname();

  const navItems = [
    { label: 'Home', href: '/' },
    { label: 'Register Cooperative', href: '/cooperatives/register' },
    { label: 'Track Application', href: '/applications/status' },
    { label: 'Admin Portal', href: '/admin/applications' },
    { label: 'Co-op Dashboard', href: '/dashboard' },
    { label: 'New Collection', href: '/collections/new' },
    { label: 'Coolers', href: '/coolers' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'SMS', href: '/sms' },
    { label: 'Corrections', href: '/corrections' },
    { label: 'Reversals', href: '/reversals' },
    { label: 'Reports', href: '/reports' },
    { label: 'Payments', href: '/admin/payments' },
  ];

  return (
    <header className="navbar">
      <div className="nav-container">
        <div className="nav-brand">
          <Link href="/">🥛 MaziwaCollect</Link>
        </div>
        <nav className="nav-tabs">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-tab ${isActive ? 'active' : ''}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}