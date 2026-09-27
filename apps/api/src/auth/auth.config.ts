import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthConfig {
  /** Base project URL, e.g. https://abcd.supabase.co or http://127.0.0.1:54321 for the local CLI stack. */
  readonly supabaseUrl: string;
  /** Issuer claim Supabase writes into access tokens. */
  readonly issuer: string;
  readonly audience = 'authenticated';
  /** Only for projects still on the legacy shared HS256 secret; asymmetric JWKS keys are preferred. */
  readonly legacyJwtSecret?: string;
  readonly serviceRoleKey?: string;
  /** Platform roles, managers and accountants must hold an aal2 (TOTP) session. */
  readonly requireMfa: boolean;
  readonly webUrl: string;

  constructor() {
    const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
    if (!url) throw new Error('SUPABASE_URL is required: the API cannot verify sessions without it');
    this.supabaseUrl = url;
    this.issuer = process.env.SUPABASE_JWT_ISSUER || `${url}/auth/v1`;
    this.legacyJwtSecret = process.env.SUPABASE_JWT_SECRET || undefined;
    this.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || undefined;
    this.requireMfa = process.env.AUTH_REQUIRE_MFA !== 'false';
    this.webUrl = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/+$/, '');
  }
}
