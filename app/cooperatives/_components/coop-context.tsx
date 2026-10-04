'use client';

import { createContext, useContext } from 'react';
import type { SyncPhase } from '@/lib/sync/engine';
import type { Overview } from '../_types/coop-types';

interface CoopContextValue {
  overview: Overview;
  email?: string;
  /** Only the cooperative admin may add, edit or deactivate team members. */
  canManageTeam: boolean;
  /** Re-reads the overview (counts, SMS credits) after something changed. */
  refresh: () => Promise<void>;
  /** The MilkOS server is reachable right now. */
  isOnline: boolean;
  /** This device holds an offline session for the user (local data + sync queue in use). */
  offlineCapable: boolean;
  /** How long offline access remains (e.g. "6 days"). */
  offlineAccess: string | null;
  syncStatus: SyncPhase;
  pendingCount: number;
  lastSyncAt: string | null;
  syncNow: () => Promise<void>;
}

const CoopContext = createContext<CoopContextValue | null>(null);

export const CoopProvider = CoopContext.Provider;

export function useCoop(): CoopContextValue {
  const value = useContext(CoopContext);
  if (!value) throw new Error('useCoop must be used inside the cooperative layout');
  return value;
}
