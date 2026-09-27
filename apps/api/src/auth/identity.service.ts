import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import type { AuthPrincipal, SupabaseClaims } from './auth.types';

const principalInclude = {
  memberships: {
    where: { status: { in: ['ACTIVE', 'INVITED'] } },
    include: { cooperative: { select: { name: true, status: true } } },
  },
} satisfies Prisma.UserInclude;

type UserWithMemberships = Prisma.UserGetPayload<{ include: typeof principalInclude }>;

/**
 * Maps a verified Supabase session onto the Milkos User. Roles and tenant
 * memberships are read from our database on every request, so revocations
 * take effect immediately instead of waiting for the JWT to expire.
 *
 * Runs on the owner connection (not a tenant transaction) because it spans
 * every cooperative the user belongs to.
 */
@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolvePrincipal(claims: SupabaseClaims, ctx: { ip?: string; userAgent?: string; requestId?: string }): Promise<AuthPrincipal> {
    let user = await this.prisma.user.findUnique({ where: { authUserId: claims.sub }, include: principalInclude });
    if (!user) user = await this.createUser(claims);
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'This account has been suspended' });
    }
    if (claims.session_id && claims.session_id !== user.lastSessionId) {
      user = await this.onNewSession(user, claims, ctx);
    }
    return this.toPrincipal(user, claims);
  }

  private async createUser(claims: SupabaseClaims): Promise<UserWithMemberships> {
    try {
      return await this.prisma.user.create({
        data: { authUserId: claims.sub, email: claims.email?.toLowerCase() || null, phone: claims.phone || null, displayName: displayNameFrom(claims) },
        include: principalInclude,
      });
    } catch (error) {
      // Two first requests raced; the other one created the row.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.user.findUniqueOrThrow({ where: { authUserId: claims.sub }, include: principalInclude });
      }
      throw error;
    }
  }

  /** First request of a new Supabase session: sync profile, accept pending invitations, record the sign-in. */
  private async onNewSession(user: UserWithMemberships, claims: SupabaseClaims, ctx: { ip?: string; userAgent?: string; requestId?: string }) {
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.membership.updateMany({ where: { userId: user.id, status: 'INVITED' }, data: { status: 'ACTIVE', activatedAt: now } });
      await tx.securityEvent.create({
        data: {
          event: 'AUTH_SIGN_IN',
          result: 'SUCCESS',
          userId: user.id,
          ipAddress: ctx.ip || 'unknown',
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          metadata: { methods: (claims.amr || []).map((m) => m.method), aal: claims.aal, sessionId: claims.session_id },
        },
      });
      return tx.user.update({
        where: { id: user.id },
        data: {
          lastSessionId: claims.session_id,
          lastSignInAt: now,
          email: claims.email?.toLowerCase() || user.email,
          phone: claims.phone || user.phone,
        },
        include: principalInclude,
      });
    });
    return updated;
  }

  private toPrincipal(user: UserWithMemberships, claims: SupabaseClaims): AuthPrincipal {
    return {
      id: user.id,
      authUserId: user.authUserId,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      platformRole: user.platformRole,
      defaultCooperativeId: user.defaultCooperativeId,
      aal: claims.aal === 'aal2' ? 'aal2' : 'aal1',
      signInMethods: (claims.amr || []).map((m) => m.method),
      memberships: user.memberships
        .filter((m) => m.status === 'ACTIVE')
        .map((m) => ({
          id: m.id,
          cooperativeId: m.cooperativeId,
          cooperativeName: m.cooperative.name,
          cooperativeStatus: m.cooperative.status,
          role: m.role,
          status: m.status,
        })),
    };
  }
}

function displayNameFrom(claims: SupabaseClaims): string {
  const meta = claims.user_metadata || {};
  const name = [meta.full_name, meta.name].find((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return name?.trim() || claims.email?.split('@')[0] || claims.phone || 'New user';
}
