import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import type { AuthPrincipal } from '../auth/auth.types';

interface RequestCtx { ip?: string; requestId?: string }

/** Cooperative member management. Runs inside the tenant transaction, so RLS scopes every query. */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly supabase: SupabaseAdminService,
  ) {}

  list(cooperativeId: string) {
    return this.prisma.tenantClient.membership.findMany({
      where: { cooperativeId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true, role: true, status: true, createdAt: true, activatedAt: true, revokedAt: true,
        user: { select: { id: true, displayName: true, email: true, phone: true, lastSignInAt: true } },
      },
    });
  }

  async invite(actor: AuthPrincipal, cooperativeId: string, input: { email: string; displayName?: string; role: MembershipRole }, ctx: RequestCtx) {
    const email = input.email.trim().toLowerCase();
    const { authUserId, invited } = await this.supabase.inviteByEmail(email, input.displayName);
    // Identity rows are global, so they are written on the owner connection rather than the tenant transaction.
    const user = await this.prisma.user.upsert({
      where: { authUserId },
      create: { authUserId, email, displayName: input.displayName || email.split('@')[0] },
      update: {},
    });
    // New accounts stay INVITED until their first sign-in; existing accounts get access immediately.
    const status = invited ? 'INVITED' : 'ACTIVE';
    const existing = await this.prisma.tenantClient.membership.findUnique({
      where: { userId_cooperativeId_role: { userId: user.id, cooperativeId, role: input.role } },
    });
    if (existing && (existing.status === 'ACTIVE' || existing.status === 'INVITED')) {
      throw new ConflictException('This person already has that role in the cooperative');
    }
    const data = { status, invitedBy: actor.id, revokedAt: null, activatedAt: status === 'ACTIVE' ? new Date() : null } as const;
    const membership = existing
      ? await this.prisma.tenantClient.membership.update({ where: { id: existing.id }, data })
      : await this.prisma.tenantClient.membership.create({ data: { ...data, userId: user.id, cooperativeId, role: input.role } });
    await this.audit.record({
      cooperativeId, actorUserId: actor.id, action: 'MEMBER_INVITED', entityType: 'Membership', entityId: membership.id,
      result: 'SUCCESS', ipAddress: ctx.ip, requestId: ctx.requestId, metadata: { role: input.role, invitedUserId: user.id, emailSent: invited },
    });
    return { id: membership.id, role: membership.role, status: membership.status, emailSent: invited };
  }

  async updateStatus(actor: AuthPrincipal, cooperativeId: string, membershipId: string, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED', ctx: RequestCtx) {
    const membership = await this.prisma.tenantClient.membership.findFirst({ where: { id: membershipId, cooperativeId } });
    if (!membership) throw new NotFoundException('Membership not found');
    if (membership.userId === actor.id) throw new BadRequestException('You cannot change your own membership');
    if (membership.status === 'REVOKED') throw new ConflictException('Revoked memberships cannot be changed; invite the person again');
    if (membership.role === 'COOPERATIVE_MANAGER' && membership.status === 'ACTIVE' && status !== 'ACTIVE') {
      const otherManagers = await this.prisma.tenantClient.membership.count({
        where: { cooperativeId, role: 'COOPERATIVE_MANAGER', status: 'ACTIVE', id: { not: membershipId } },
      });
      if (!otherManagers) throw new ConflictException('A cooperative must keep at least one active manager');
    }
    const updated = await this.prisma.tenantClient.membership.update({
      where: { id: membershipId },
      data: { status, revokedAt: status === 'REVOKED' ? new Date() : null },
    });
    await this.audit.record({
      cooperativeId, actorUserId: actor.id, action: `MEMBER_${status}`, entityType: 'Membership', entityId: membershipId,
      result: 'SUCCESS', ipAddress: ctx.ip, requestId: ctx.requestId,
      beforeState: { status: membership.status }, afterState: { status },
    });
    return { id: updated.id, status: updated.status };
  }
}
