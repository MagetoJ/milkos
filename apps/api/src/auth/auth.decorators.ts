import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';
import type { AuthenticatedRequest } from './auth.types';

export const PERMISSIONS_KEY = 'permissions';
/** Caller must hold every listed permission. Tenant permissions also require a resolved cooperative. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export const ALLOW_AAL1_KEY = 'allowAal1';
/** Reachable before MFA step-up (profile bootstrap, MFA status). Use sparingly. */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_AAL1_KEY, true);

export const PLATFORM_SCOPE_KEY = 'platformScope';
/** Never resolves a cooperative for this route: no tenant transaction is opened even if x-cooperative-id is sent. */
export const PlatformScope = () => SetMetadata(PLATFORM_SCOPE_KEY, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthenticatedRequest>().tenant,
);
