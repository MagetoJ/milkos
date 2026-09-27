import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ALLOW_AAL1_KEY, PERMISSIONS_KEY, PLATFORM_SCOPE_KEY } from './auth.decorators';
import { AuthConfig } from './auth.config';
import {
  isTenantPermission, MFA_MEMBERSHIP_ROLES, MFA_PLATFORM_ROLES, Permission, platformPermissions, tenantPermissions,
} from './permissions';
import type { AuthenticatedRequest, AuthPrincipal, RequestTenant } from './auth.types';

/**
 * Authorization, in order:
 *  1. MFA step-up for privileged users (aal2).
 *  2. Resolve which cooperative the request targets and prove the caller may act in it.
 *  3. Check declared permissions against the caller's roles in that cooperative.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AuthConfig,
  ) {}

  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user!;

    if (this.config.requireMfa && user.aal !== 'aal2' && requiresMfa(user)
      && !this.reflector.getAllAndOverride<boolean>(ALLOW_AAL1_KEY, targets)) {
      throw new ForbiddenException({ code: 'MFA_REQUIRED', message: 'Verify with your authenticator app to continue' });
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets) || [];
    const needsTenant = required.some(isTenantPermission);
    if (!this.reflector.getAllAndOverride<boolean>(PLATFORM_SCOPE_KEY, targets)) {
      req.tenant = await this.resolveTenant(req, user, needsTenant);
    }
    if (needsTenant && !req.tenant) {
      throw new BadRequestException({ code: 'TENANT_REQUIRED', message: 'Select a cooperative using the x-cooperative-id header' });
    }

    const granted = new Set<Permission>([
      ...platformPermissions(user.platformRole),
      ...(req.tenant ? tenantPermissions(user.platformRole, req.tenant.roles) : []),
    ]);
    req.permissions = granted;
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length) {
      await this.audit.security({
        event: 'AUTHORIZATION_DENIED', result: 'DENIED', reason: `missing:${missing.join(',')}`,
        userId: user.id, cooperativeId: req.tenant?.cooperativeId, ipAddress: req.ip || 'unknown', requestId: req.requestId,
      });
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'You do not have permission to perform this action' });
    }
    return true;
  }

  private async resolveTenant(req: AuthenticatedRequest, user: AuthPrincipal, needsTenant: boolean): Promise<RequestTenant | undefined> {
    const header = req.headers['x-cooperative-id'];
    // Route/body/query identifiers are explicit and win over the ambient header,
    // but they must agree with each other.
    const explicit = [
      req.params?.cooperativeId,
      typeof req.body?.cooperativeId === 'string' ? req.body.cooperativeId : undefined,
      req.query?.cooperativeId,
    ].filter((v): v is string => Boolean(v));
    if (new Set(explicit).size > 1) throw new BadRequestException('Conflicting cooperative identifiers in request');
    let cooperativeId = explicit[0] || (Array.isArray(header) ? header[0] : header);

    if (!cooperativeId) {
      if (!needsTenant) return undefined;
      if (user.memberships.length === 1) cooperativeId = user.memberships[0].cooperativeId;
      else if (user.defaultCooperativeId && user.memberships.some((m) => m.cooperativeId === user.defaultCooperativeId)) {
        cooperativeId = user.defaultCooperativeId;
      } else return undefined;
    }

    const memberships = user.memberships.filter((m) => m.cooperativeId === cooperativeId);
    const roles = [...new Set(memberships.map((m) => m.role))];

    if (user.platformRole) {
      const exists = await this.prisma.cooperative.count({ where: { id: cooperativeId } });
      if (!exists) throw new NotFoundException('Cooperative not found');
      const viaPlatformRole = roles.length === 0;
      if (viaPlatformRole && req.method !== 'GET') {
        await this.audit.security({
          event: 'PLATFORM_TENANT_ACCESS', result: 'SUCCESS', userId: user.id, cooperativeId,
          ipAddress: req.ip || 'unknown', requestId: req.requestId, metadata: { method: req.method, platformRole: user.platformRole },
        });
      }
      return { cooperativeId, roles, viaPlatformRole };
    }

    if (!memberships.length) {
      await this.audit.security({
        event: 'TENANT_ACCESS_DENIED', result: 'DENIED', reason: 'NO_MEMBERSHIP',
        userId: user.id, ipAddress: req.ip || 'unknown', requestId: req.requestId, metadata: { cooperativeId },
      });
      throw new ForbiddenException({ code: 'TENANT_FORBIDDEN', message: 'You do not have access to this cooperative' });
    }
    if (memberships[0].cooperativeStatus !== 'APPROVED') {
      throw new ForbiddenException({ code: 'TENANT_INACTIVE', message: 'This cooperative is not active' });
    }
    return { cooperativeId, roles, viaPlatformRole: false };
  }
}

export function requiresMfa(user: AuthPrincipal): boolean {
  return (user.platformRole !== null && MFA_PLATFORM_ROLES.includes(user.platformRole))
    || user.memberships.some((m) => MFA_MEMBERSHIP_ROLES.includes(m.role));
}
