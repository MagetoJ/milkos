// lib/hooks/use-session-timeout.ts
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export function useSessionTimeout(onLogout: () => void) {
  useEffect(() => {
    let timer: NodeJS.Timeout;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        onLogout();
      }, IDLE_TIMEOUT_MS);
    };

    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, resetTimer));

    resetTimer(); // Initialize timer

    return () => {
      clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [onLogout]);
}