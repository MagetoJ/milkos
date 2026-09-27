'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

interface GoogleButtonProps {
  next: string;
  onError: (message: string) => void;
}

export function GoogleButton({ next, onError }: GoogleButtonProps) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    // On success the browser navigates to Google; we only get here on failure.
    if (error) {
      setPending(false);
      onError('Google sign-in is unavailable right now. Try email instead.');
    }
  }

  return (
    <Button type="button" variant="outline" size="lg" className="w-full" onClick={signIn} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <GoogleMark />}
      Continue with Google
    </Button>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.28v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.3A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.57.38-2.3V6.6H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.4l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.28 6.6l4 3.1C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}
