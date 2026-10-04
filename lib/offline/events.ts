// A tiny change bus: screens that read the local database re-read when something they show changed
// (a local edit, a pull, a sync result). Keeps data in IndexedDB instead of a global React store.
import type { LocalTable } from './types';

type Listener = (tables: Set<LocalTable | 'queue'>) => void;
const listeners = new Set<Listener>();

export function onLocalChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitLocalChange(...tables: (LocalTable | 'queue')[]) {
  const set = new Set(tables);
  for (const listener of listeners) listener(set);
}
