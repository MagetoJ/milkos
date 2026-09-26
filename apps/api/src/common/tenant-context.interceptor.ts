import { BadRequestException, ForbiddenException, Injectable, NestInterceptor, UnauthorizedException, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, from, lastValueFrom, mergeMap } from 'rxjs';
import { PrismaService } from './prisma.service';

interface AuthenticatedRequest {
  user?: {
    sub?: string;
    realm_access?: { roles?: string[] };
  };
  params?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  tenant?: { cooperativeId: string };
}

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return from(this.resolveCooperative(request)).pipe(
      mergeMap((cooperativeId) => {
        if (!cooperativeId) return next.handle();
        request.tenant = { cooperativeId };
        return from(this.prisma.withTenantContext(cooperativeId, () => lastValueFrom(next.handle())));
      }),
    );
  }

  private async resolveCooperative(request: AuthenticatedRequest): Promise<string | undefined> {
    const header = request.headers['x-cooperative-id'];
    const requestedId = request.params?.cooperativeId
      || request.body?.cooperativeId as string | undefined
      || request.query?.cooperativeId
      || (Array.isArray(header) ? header[0] : header);
    const user = request.user;

    if (!user?.sub) {
      if (requestedId) throw new UnauthorizedException('Authentication is required for cooperative data');
      return undefined;
    }

    const isPlatformAdmin = (user.realm_access?.roles || []).some(
      (role) => role === 'PLATFORM_ADMIN' || role === 'PLATFORM_SUPER_ADMIN',
    );
    if (isPlatformAdmin) return requestedId || undefined;

    const databaseUser = await this.prisma.user.findUnique({
      where: { keycloakId: user.sub },
      include: { memberships: { where: { status: 'ACTIVE' }, select: { cooperativeId: true } } },
    });
    const memberships = databaseUser?.memberships || [];

    if (requestedId) {
      if (!memberships.some((membership) => membership.cooperativeId === requestedId)) {
        throw new ForbiddenException('You do not have access to this cooperative');
      }
      return requestedId;
    }

    if (memberships.length === 1) return memberships[0].cooperativeId;
    if (memberships.length > 1 && this.isTenantRoute(request)) {
      throw new BadRequestException('Select a cooperative using the x-cooperative-id header');
    }
    return undefined;
  }

  private isTenantRoute(request: AuthenticatedRequest) {
    return Boolean(request.params?.cooperativeId || request.body?.cooperativeId);
  }
}