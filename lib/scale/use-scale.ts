'use client';

// React binding for one ScaleAdapter: connection state, the live weight, tare and capture.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScaleAdapterDefinition } from './registry';
import type { ScaleAdapter, ScaleStatus, WeightReading } from './types';

export interface UseScale {
  definition: ScaleAdapterDefinition | null;
  status: ScaleStatus | null;
  reading: WeightReading | null;
  error: string | null;
  connect: (definition: ScaleAdapterDefinition) => Promise<void>;
  disconnect: () => Promise<void>;
  tare: () => Promise<void>;
  capture: () => Promise<WeightReading | null>;
  /** The adapter, for simulator controls in development. */
  adapter: ScaleAdapter | null;
}

export function useScale(): UseScale {
  const adapterRef = useRef<ScaleAdapter | null>(null);
  const cleanup = useRef<(() => void)[]>([]);
  const [adapter, setAdapter] = useState<ScaleAdapter | null>(null);
  const [definition, setDefinition] = useState<ScaleAdapterDefinition | null>(null);
  const [status, setStatus] = useState<ScaleStatus | null>(null);
  const [reading, setReading] = useState<WeightReading | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disconnect = useCallback(async () => {
    cleanup.current.forEach((off) => off());
    cleanup.current = [];
    const adapter = adapterRef.current;
    adapterRef.current = null;
    setAdapter(null);
    if (adapter) await adapter.disconnect().catch(() => undefined);
    setStatus(adapter ? { ...adapter.getStatus(), state: 'disconnected' } : null);
    setReading(null);
    setDefinition(null);
  }, []);

  const connect = useCallback(
    async (def: ScaleAdapterDefinition) => {
      await disconnect();
      const adapter = def.create();
      adapterRef.current = adapter;
      setAdapter(adapter);
      setDefinition(def);
      setError(null);
      cleanup.current.push(adapter.onStatusChange(setStatus), adapter.subscribeToWeightUpdates(setReading));
      try {
        await adapter.connect();
        setStatus(adapter.getStatus());
        console.info('[milkos.scale] connected', { transport: adapter.transport, key: def.key });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not connect to the scale.');
        setStatus(adapter.getStatus());
      }
    },
    [disconnect],
  );

  const tare = useCallback(async () => {
    try {
      await adapterRef.current?.tare();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tare failed.');
    }
  }, []);

  const capture = useCallback(async () => {
    try {
      const r = (await adapterRef.current?.capture()) ?? null;
      setError(null);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Capture failed.');
      return null;
    }
  }, []);

  // Disconnect when the screen goes away.
  useEffect(() => () => void disconnect(), [disconnect]);

  return { definition, status, reading, error, connect, disconnect, tare, capture, adapter };
}
