import { z } from 'zod';

/** Mirrors the Supabase project policy (supabase/config.toml: minimum_password_length, password_requirements). */
export const passwordRule = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[a-z]/, 'Add a lower-case letter')
  .regex(/[A-Z]/, 'Add an upper-case letter')
  .regex(/\d/, 'Add a number');
