import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SupabaseJwtService } from './supabase-jwt.service';
import { IdentityService } from './identity.service';
import type { AuthenticatedRequest } from './auth.types';

/** Authentication: verifies the Supabase access token and attaches the Milkos principal. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: SupabaseJwtService,
    private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) throw new UnauthorizedException();

    const claims = await this.jwt.verify(header.slice(7));
    const userAgent = req.headers['user-agent'];
    req.user = await this.identity.resolvePrincipal(claims, {
      ip: req.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      requestId: req.requestId,
    });
    return true;
  }
}
