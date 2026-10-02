'use client';

import { createContext, useContext } from 'react';
import type { Overview } from '../_types/coop-types';

interface CoopContextValue {
  overview: Overview;
  email?: string;
  /** Only the cooperative admin may add, edit or deactivate team members. */
  canManageTeam: boolean;
  /** Re-reads the overview (counts, SMS credits) after something changed. */
  refresh: () => Promise<void>;
}

const CoopContext = createContext<CoopContextValue | null>(null);

export const CoopProvider = CoopContext.Provider;

export function useCoop(): CoopContextValue {
  const value = useContext(CoopContext);
  if (!value) throw new Error('useCoop must be used inside the cooperative layout');
  return value;
}