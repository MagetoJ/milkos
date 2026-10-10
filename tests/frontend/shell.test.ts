// Workspace shell (spec §6, §7): grouped navigation filtered by permission, and the always-visible
// cooperative / cooler context.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { coopNav, type NavInput } from '@/app/cooperatives/_components/nav';
import { CoolerSwitcher, TenantSwitcher, coolerStatus, tenantStatus } from '@/components/shell/context-switchers';
import { can, canAny } from '@/lib/permissions';

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const base: NavInput = { role: 'COOP_ADMIN', offlineCapable: false, unread: 0, activeFarmers: 12, operationalCoolers: 2, activeCentres: 3 };
const titles = (i: NavInput) => coopNav(i).map((g) => g.title);
const labels = (i: NavInput) => coopNav(i).flatMap((g) => g.items.map((x) => x.label));

describe('navigation groups (spec §6)', () => {
  it('uses the spec groups in the spec order', () => {
    expect(titles(base)).toEqual(['Overview', 'Operations', 'Finance', 'Reporting', 'Management', 'Governance']);
  });

  it('puts each screen under the right group', () => {
    const by = Object.fromEntries(coopNav(base).map((g) => [g.title, g.items.map((x) => x.label)]));
    expect(by.Overview).toContain('Dashboard');
    expect(by.Operations).toEqual(expect.arrayContaining(['Milk collections', 'Farmers', 'Collection centres']));
    expect(by.Finance).toEqual(['Milk pricing', 'SMS credits', 'Farmer payments']);
    expect(by.Reporting).toEqual(['Reports']);
    expect(by.Management).toEqual(expect.arrayContaining(['Team', 'Settings']));
    expect(by.Governance).toEqual(['Corrections & reversals']);
  });

  it('shows the Sync center only on devices that work offline', () => {
    expect(labels(base)).not.toContain('Sync center');
    expect(labels({ ...base, offlineCapable: true })).toContain('Sync center');
  });

  it('hides what the role has no permission for, and drops groups that end up empty', () => {
    // A collector holds no pricing, SMS, payment, report or user permissions.
    const collector = labels({ ...base, role: 'COLLECTOR' });
    for (const hidden of ['Milk pricing', 'SMS credits', 'Farmer payments', 'Reports', 'Team']) expect(collector).not.toContain(hidden);
    expect(titles({ ...base, role: 'COLLECTOR' })).not.toContain('Finance');
    expect(titles({ ...base, role: 'COLLECTOR' })).not.toContain('Reporting');
    // An unknown role gets only what needs no permission.
    expect(labels({ ...base, role: 'NOBODY' })).toEqual(['Dashboard', 'Notifications', 'My settings']);
  });

  it('carries counts and labels settings by role', () => {
    const groups = coopNav({ ...base, unread: 4, pendingPayments: 2, pendingCorrections: 5 });
    const item = (label: string) => groups.flatMap((g) => g.items).find((x) => x.label === label);
    expect(item('Notifications')?.count).toBe(4);
    expect(item('Farmer payments')?.count).toBe(2);
    expect(item('Corrections & reversals')?.count).toBe(5);
    expect(item('Settings')).toBeTruthy();
    expect(coopNav({ ...base, role: 'MANAGER' }).flatMap((g) => g.items).map((x) => x.label)).toContain('My settings');
  });
});

describe('permission helper', () => {
  it('answers from the mirrored backend table', () => {
    expect(can('COOP_ADMIN', 'pricing.manage')).toBe(true);
    expect(can('MANAGER', 'pricing.manage')).toBe(false);
    expect(can('MANAGER', 'pricing.read')).toBe(true);
    expect(can('COLLECTOR', 'collection.create')).toBe(true);
    expect(can('FARMER', 'farmer.read')).toBe(false);
    expect(can(undefined, 'farmer.read')).toBe(false);
    expect(can('SUPER_ADMIN', 'cooperative.suspend')).toBe(true);
  });

  it('treats no restriction as allowed and any-of as any', () => {
    expect(canAny('FARMER')).toBe(true);
    expect(canAny('FARMER', ['farmer.read', 'collection.read'])).toBe(true);
    expect(canAny('FARMER', ['farmer.read', 'report.read'])).toBe(false);
  });
});

describe('cooperative and cooler context (spec §7)', () => {
  it('shows the cooperative name, code, place and status in words', () => {
    const out = html(createElement(TenantSwitcher, { name: 'Limuru Dairy Farmers', code: 'LDF-001', location: 'Limuru, Kiambu', status: 'online' }));
    expect(out).toContain('Limuru Dairy Farmers');
    expect(out).toContain('LDF-001 · Limuru, Kiambu');
    expect(out).toContain('Online');
    expect(out).toContain('aria-label="Cooperative: Limuru Dairy Farmers"');
    expect(out).toContain('>LD<'); // initials stand in for a logo
  });

  it('uses the logo when the cooperative has one', () => {
    const out = html(createElement(TenantSwitcher, { name: 'Limuru Dairy', status: 'online', logoUrl: 'https://cdn.example/logo.png' }));
    expect(out).toContain('src="https://cdn.example/logo.png"');
  });

  it('maps record flags to status words (never colour alone)', () => {
    expect(coolerStatus({ status: 'ACTIVE', is_operational: true })).toBe('online');
    expect(coolerStatus({ status: 'ACTIVE', is_operational: false })).toBe('offline');
    expect(coolerStatus({ status: 'INACTIVE', is_operational: true })).toBe('inactive');
    expect(tenantStatus('ACTIVE')).toBe('online');
    expect(tenantStatus('SUSPENDED')).toBe('inactive');
    const out = html(createElement(TenantSwitcher, { name: 'X Coop', status: 'inactive' }));
    expect(out).toContain('Inactive');
  });

  const coolers = [
    { id: 'a', name: 'Kiserian Cooler', location: 'Kiserian', status: 'online' as const },
    { id: 'b', name: 'Ngong Cooler', location: 'Ngong', status: 'offline' as const },
  ];

  it('shows the current cooler with its place and status and offers to change it when there are several', () => {
    const out = html(createElement(CoolerSwitcher, { coolers, valueId: 'a', onChange: () => undefined }));
    expect(out).toContain('Kiserian Cooler');
    expect(out).toContain('Kiserian');
    expect(out).toContain('Online');
    expect(out).toContain('aria-haspopup="listbox"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('Ngong'); // the list is closed
  });

  it('has nothing to switch with one cooler, and says so plainly with none', () => {
    const one = html(createElement(CoolerSwitcher, { coolers: [coolers[0]], valueId: 'a', onChange: () => undefined }));
    expect(one).toContain('Kiserian Cooler');
    expect(one).not.toContain('aria-haspopup');
    expect(html(createElement(CoolerSwitcher, { coolers: [], valueId: null, onChange: () => undefined }))).toContain('No coolers set up');
  });

  it('says it is loading rather than empty while the cooler list is still being read', () => {
    expect(html(createElement(CoolerSwitcher, { coolers: [], valueId: null, onChange: () => undefined, loading: true }))).toContain('Loading coolers');
    // ...but once a current cooler is known it is shown even while the list refreshes.
    expect(html(createElement(CoolerSwitcher, { coolers, valueId: 'a', onChange: () => undefined, loading: true }))).toContain('Kiserian Cooler');
  });
});
