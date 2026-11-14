import React from 'react';

interface TenantSwitcherProps {
  name: string;
  code: string;
  location: string;
  status?: string;
  logoUrl?: string;
}

export function TenantSwitcher({ name, code, location, status, logoUrl }: TenantSwitcherProps) {
  return (
    <div data-testid="tenant-switcher" className="flex items-center gap-3 p-2">
      {logoUrl && <img src={logoUrl} alt={name} className="w-8 h-8 rounded-full object-cover" />}
      <div>
        <h2 className="font-semibold text-gray-900">{name}</h2>
        <p className="text-xs text-gray-500">{code} · {location}</p>
      </div>
      {status && <span className="ml-auto text-xs font-medium px-2 py-1 rounded bg-gray-100">{status}</span>}
    </div>
  );
}
