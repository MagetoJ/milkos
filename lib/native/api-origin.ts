const ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN ?? '').replace(/\/+$/, '');

if (typeof window !== 'undefined' && ORIGIN && !(window as unknown as { __apiOrigin?: boolean }).__apiOrigin) {
  (window as unknown as { __apiOrigin?: boolean }).__apiOrigin = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/v1')) input = ORIGIN + input;
    return nativeFetch(input, init);
  };
}
export {};
