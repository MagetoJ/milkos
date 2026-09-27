import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, JWTPayload } from 'jose';
import { AuthConfig } from './auth.config';
import type { SupabaseClaims } from './auth.types';

@Injectable()
export class SupabaseJwtService {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly legacySecret?: Uint8Array;

  constructor(private readonly config: AuthConfig) {
    this.jwks = createRemoteJWKSet(new URL(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`));
    if (config.legacyJwtSecret) this.legacySecret = new TextEncoder().encode(config.legacyJwtSecret);
  }

  async verify(token: string): Promise<SupabaseClaims> {
    let payload: JWTPayload;
    try {
      const { alg } = decodeProtectedHeader(token);
      const options = { issuer: this.config.issuer, audience: this.config.audience };
      if (alg === 'HS256') {
        if (!this.legacySecret) throw new Error('HS256 token received but SUPABASE_JWT_SECRET is not configured');
        ({ payload } = await jwtVerify(token, this.legacySecret, { ...options, algorithms: ['HS256'] }));
      } else {
        ({ payload } = await jwtVerify(token, this.jwks, { ...options, algorithms: ['ES256', 'RS256'] }));
      }
    } catch {
      throw new UnauthorizedException();
    }
    // Service-role and anon keys are also valid JWTs; only end-user sessions may call the API.
    if (typeof payload.sub !== 'string' || payload.role !== 'authenticated') throw new UnauthorizedException();
    return payload as unknown as SupabaseClaims;
  }
}
