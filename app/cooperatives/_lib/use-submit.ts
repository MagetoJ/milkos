'use client';

import { useCallback, useState } from 'react';
import { ApiError } from '../_api/coop-client';

/**
 * Runs a save action and sorts any failure into per-field messages (shown under the inputs)
 * or one form-level message (shown above the buttons).
 */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setFieldErrors({});
    setFormError(null);
    try {
      await action();
      return true;
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length > 0) {
        setFieldErrors(e.fields);
        // A message for a field that isn't on this form still has to be seen.
        setFormError(e.fields.form ?? null);
      } else {
        setFormError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, fieldErrors, formError, run };
}