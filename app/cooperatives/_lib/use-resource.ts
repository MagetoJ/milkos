'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Loads data when `deps` change; a slower, older response can never overwrite a newer one. */
export function useResource<T>(fetcher: () => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true);
    try {
      const result = await fetcher();
      if (id !== latest.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (id === latest.current) setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, deps);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}