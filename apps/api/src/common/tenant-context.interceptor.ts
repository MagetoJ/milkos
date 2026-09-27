import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, lastValueFrom } from 'rxjs';
import { PrismaService } from './prisma.service';
import type { AuthenticatedRequest } from '../auth/auth.types';

/** Wraps tenant requests (req.tenant set by AccessGuard) in an RLS-bound transaction. */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.tenant) return next.handle();
    return from(this.prisma.withTenantContext(
      request.tenant.cooperativeId,
      () => lastValueFrom(next.handle()),
      request.user?.id,
    ));
  }
}
