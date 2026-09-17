import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  private readonly jwks = createRemoteJWKSet(new URL(`${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/certs`));
  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    const req = context.switchToHttp().getRequest();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      const token = header.slice(7);
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: process.env.KEYCLOAK_ISSUER,
        audience: process.env.KEYCLOAK_AUDIENCE,
      });
      req.user = payload as JWTPayload & { sub: string; realm_access?: { roles?: string[] } };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
