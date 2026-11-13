import React from 'react';

export type ContextCooler = { id: string; name: string };

interface SwitcherProps {
  compact?: boolean;
  coolers?: ContextCooler[];
  valueId?: string | null;
  onChange?: (id: string) => void;
  loading?: boolean;
  name?: string;
  code?: string;
  location?: string;
  status?: string;
  logoUrl?: string;
}

export function CoolerSwitcher(_props: SwitcherProps) {
  return <div data-testid="cooler-switcher">Cooler Switcher</div>;
}

export function TenantSwitcher(_props: SwitcherProps) {
  return <div data-testid="tenant-switcher">Tenant Switcher</div>;
}

export function coolerStatus(cooler: any): string {
  return cooler?.status || "active";
}

export function tenantStatus(tenant: any): string {
  return tenant?.status || "active";
}
