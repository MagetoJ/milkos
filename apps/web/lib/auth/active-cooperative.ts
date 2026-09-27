// The tenant the user is currently working in. Kept per-browser for instant
// switching; the API remembers the last choice as User.defaultCooperativeId.
const STORAGE_KEY = 'milkos.activeCooperativeId';

let current: string | null = null;

export function getActiveCooperativeId(): string | null {
  if (current) return current;
  try {
    current = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    current = null;
  }
  return current;
}

export function setActiveCooperativeId(id: string | null) {
  current = id;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode): the in-memory value still works for this tab.
  }
}
