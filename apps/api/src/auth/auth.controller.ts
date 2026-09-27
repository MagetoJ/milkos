import { Body, Controller, ForbiddenException, Get, NotFoundException, Put } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AllowWithoutMfa, CurrentUser, PlatformScope } from './auth.decorators';
import { AuthConfig } from './auth.config';
import { requiresMfa } from './access.guard';
import { platformPermissions, tenantPermissions } from './permissions';
import { SetDefaultCooperativeDto } from './dto';
import type { AuthPrincipal } from './auth.types';

@PlatformScope()
@Controller('auth')
export class AuthController {
  constructor(private readonly prisma: PrismaService, private readonly config: AuthConfig) {}

  /**
   * Session bootstrap for the web app: who am I, which cooperatives can I act
   * in, and what may I do in each. Reachable at aal1 so the client can learn
   * that MFA step-up is required.
   */
  @AllowWithoutMfa()
  @Get('me')
  me(@CurrentUser() user: AuthPrincipal) {
    const byCooperative = new Map<string, { id: string; name: string; status: string; roles: AuthPrincipal['memberships'][number]['role'][] }>();
    for (const m of user.memberships) {
      const entry = byCooperative.get(m.cooperativeId) || { id: m.cooperativeId, name: m.cooperativeName, status: m.cooperativeStatus, roles: [] };
      entry.roles.push(m.role);
      byCooperative.set(m.cooperativeId, entry);
    }
    const mfaRequired = this.config.requireMfa && requiresMfa(user);
    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.displayName,
        platformRole: user.platformRole,
        defaultCooperativeId: user.defaultCooperativeId,
      },
      session: {
        aal: user.aal,
        signInMethods: user.signInMethods,
        mfaRequired,
        mfaSatisfied: !mfaRequired || user.aal === 'aal2',
      },
      platformPermissions: platformPermissions(user.platformRole),
      /** What platform staff may do inside a cooperative they are not a member of. */
      platformTenantPermissions: user.platformRole ? tenantPermissions(user.platformRole, []) : [],
      cooperatives: [...byCooperative.values()].map((c) => ({
        ...c,
        permissions: tenantPermissions(user.platformRole, c.roles),
      })),
    };
  }

  @Put('me/default-cooperative')
  async setDefaultCooperative(@CurrentUser() user: AuthPrincipal, @Body() dto: SetDefaultCooperativeDto) {
    const isMember = user.memberships.some((m) => m.cooperativeId === dto.cooperativeId);
    if (!isMember) {
      if (!user.platformRole) throw new ForbiddenException('You do not have access to this cooperative');
      if (!(await this.prisma.cooperative.count({ where: { id: dto.cooperativeId } }))) throw new NotFoundException('Cooperative not found');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { defaultCooperativeId: dto.cooperativeId } });
    return { defaultCooperativeId: dto.cooperativeId };
  }
}
