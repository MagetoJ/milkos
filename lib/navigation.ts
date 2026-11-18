// In the Android (Capacitor) app, a full page load of "/superadmin" is answered by Capacitor's local server
// with the root index.html (its SPA fallback serves any URL whose last segment has no "."), which bounces
// between the landing page and the login page forever. Inside the app we therefore navigate with the Next.js
// router, which only requests files (".txt", ".js") that the local server serves correctly.
// On the web, behaviour is unchanged: a normal browser navigation.

interface RouterLike {
  push(path: string): void;
  replace(path: string): void;
}

let router: RouterLike | null = null;

export function registerRouter(next: RouterLike | null) {
  router = next;
}

function isNative(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() ?? false;
}

/** Go to an in-app path (drop-in for window.location.assign / replace). */
export function navigate(path: string, mode: 'assign' | 'replace' = 'assign') {
  if (typeof window === 'undefined') return;
  if (router && isNative()) {
    if (mode === 'replace') router.replace(path);
    else router.push(path);
    return;
  }
  if (mode === 'replace') window.location.replace(path);
  else window.location.assign(path);
}
