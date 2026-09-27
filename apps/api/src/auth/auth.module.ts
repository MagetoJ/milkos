import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuditService } from '../audit/audit.service';
import { MembershipsController } from '../memberships/memberships.controller';
import { MembershipsService } from '../memberships/memberships.service';
import { AccessGuard } from './access.guard';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { IdentityService } from './identity.service';
import { SupabaseAdminService } from './supabase-admin.service';
import { SupabaseJwtService } from './supabase-jwt.service';

/** Guard order matters: rate limit → authenticate → authorize (tenant + permissions). */
@Global()
@Module({
  controllers: [AuthController, AdminUsersController, MembershipsController],
  providers: [
    AuthConfig,
    AuditService,
    SupabaseJwtService,
    SupabaseAdminService,
    IdentityService,
    AdminUsersService,
    MembershipsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [AuthConfig, AuditService, SupabaseAdminService],
})
export class AuthModule {}
