import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformRole, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SupabaseAdminService } from './supabase-admin.service';
import type { AuthPrincipal } from './auth.types';

interface RequestCtx { ip?: string; requestId?: string }

/** Platform user administration. Runs on the owner connection: it is cross-tenant by design. */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly supabase: SupabaseAdminService,
  ) {}

  async list(q?: string, take = 50) {
    const where: Prisma.UserWhereInput | undefined = q
      ? { OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
      ] }
      : undefined;
    const users = await this.prisma.user.findMany({
      where,
      take,
      orderBy: [{ platformRole: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: {
        id: true, email: true, phone: true, displayName: true, platformRole: true, status: true,
        lastSignInAt: true, createdAt: true,
        memberships: { where: { status: 'ACTIVE' }, select: { role: true, cooperative: { select: { id: true, name: true } } } },
      },
    });
    return users;
  }

  async listCooperatives() {
    return this.prisma.cooperative.findMany({ select: { id: true, name: true, status: true }, orderBy: { name: 'asc' } });
  }

  async invite(actor: AuthPrincipal, input: { email: string; displayName?: string; platformRole: PlatformRole }, ctx: RequestCtx) {
    const email = input.email.trim().toLowerCase();
    const { authUserId, invited } = await this.supabase.inviteByEmail(email, input.displayName);
    const user = await this.prisma.user.upsert({
      where: { authUserId },
      create: { authUserId, email, displayName: input.displayName || email.split('@')[0], platformRole: input.platformRole },
      update: { platformRole: input.platformRole },
    });
    await this.record(actor, 'PLATFORM_USER_INVITED', user.id, { platformRole: input.platformRole, invited }, ctx);
    return { id: user.id, email, platformRole: user.platformRole, invited };
  }

  async setPlatformRole(actor: AuthPrincipal, userId: string, platformRole: PlatformRole | null, ctx: RequestCtx) {
    const target = await this.loadTarget(actor, userId);
    if (target.platformRole === 'PLATFORM_SUPER_ADMIN' && platformRole !== 'PLATFORM_SUPER_ADMIN') await this.assertAnotherSuperAdmin(userId);
    await this.prisma.user.update({ where: { id: userId }, data: { platformRole } });
    await this.record(actor, 'PLATFORM_ROLE_CHANGED', userId, { from: target.platformRole, to: platformRole }, ctx);
    return { id: userId, platformRole };
  }

  async setStatus(actor: AuthPrincipal, userId: string, status: UserStatus, ctx: RequestCtx) {
    const target = await this.loadTarget(actor, userId);
    if (status === 'SUSPENDED' && target.platformRole === 'PLATFORM_SUPER_ADMIN') await this.assertAnotherSuperAdmin(userId);
    await this.prisma.user.update({ where: { id: userId }, data: { status } });
    await this.supabase.setBanned(target.authUserId, status === 'SUSPENDED');
    await this.record(actor, status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED', userId, { from: target.status }, ctx);
    return { id: userId, status };
  }

  private async loadTarget(actor: AuthPrincipal, userId: string) {
    if (actor.id === userId) throw new BadRequestException('You cannot change your own platform access');
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('User not found');
    return target;
  }

  private async assertAnotherSuperAdmin(excludingUserId: string) {
    const others = await this.prisma.user.count({
      where: { platformRole: 'PLATFORM_SUPER_ADMIN', status: 'ACTIVE', id: { not: excludingUserId } },
    });
    if (!others) throw new ConflictException('The platform must keep at least one active Super Admin');
  }

  private async record(actor: AuthPrincipal, action: string, targetUserId: string, metadata: Record<string, unknown>, ctx: RequestCtx) {
    await this.audit.record({
      actorUserId: actor.id, action, entityType: 'User', entityId: targetUserId, result: 'SUCCESS',
      ipAddress: ctx.ip, requestId: ctx.requestId, metadata,
    });
  }
}
