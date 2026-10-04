// Minimal browser surface for the offline platform, on top of Node: IndexedDB (fake-indexeddb),
// window/document event targets, localStorage and navigator.onLine.
import 'fake-indexeddb/auto';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

const storage = new MemoryStorage();
const win = Object.assign(new EventTarget(), {
  localStorage: storage,
  isSecureContext: true,
  location: { pathname: '/cooperatives', search: '', replace: () => undefined, assign: () => undefined },
  matchMedia: () => ({ matches: false }),
});
Object.assign(globalThis, { window: win, localStorage: storage });
Object.assign(globalThis, { document: Object.assign(new EventTarget(), { visibilityState: 'visible' }) });
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true, writable: true });
