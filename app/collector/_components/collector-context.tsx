'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface CollectorContextValue {
  userId: string | null;
  name: string | null;
  role: string;
  /** This phone holds an offline session (data and queue in IndexedDB). */
  offlineCapable: boolean;
}

const Ctx = createContext<CollectorContextValue>({ userId: null, name: null, role: 'COLLECTOR', offlineCapable: false });

export function CollectorProvider({ value, children }: { value: CollectorContextValue; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCollector = () => useContext(Ctx);
