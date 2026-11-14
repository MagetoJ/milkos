import React from 'react';

interface Cooler {
  id: string;
  name: string;
  location: string;
  status: string;
  is_operational: boolean;
}

interface CoolerSwitcherProps {
  coolers: Cooler[];
  valueId?: string;
  isLoading?: boolean;
  onSelect?: (cooler: Cooler) => void;
}

export function CoolerSwitcher({ coolers, valueId, isLoading }: CoolerSwitcherProps) {
  if (isLoading && (!coolers || coolers.length === 0)) {
    return (
      <div data-testid="cooler-switcher">
        <div>Loading coolers</div>
      </div>
    );
  }

  if (!coolers || coolers.length === 0) {
    return (
      <div data-testid="cooler-switcher">
        <div>No coolers</div>
      </div>
    );
  }

  const currentCooler = coolers.find(c => c.id === valueId) || coolers[0];
  const isSingle = coolers.length === 1;

  return (
    <div data-testid="cooler-switcher" {...(!isSingle ? { 'aria-haspopup': 'true' } : {})}>
      <div className="font-medium text-sm">{currentCooler.name}</div>
      <div className="text-xs text-gray-500">{currentCooler.location}</div>
      <div className="text-xs font-medium">{currentCooler.status}</div>
    </div>
  );
}
