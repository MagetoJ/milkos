import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma.module';
import { HealthController } from './health/health.controller';
import { CollectionsController } from './collections/collections.controller';
import { CollectionsService } from './collections/collections.service';
import { NotificationsService } from './notifications/notifications.service';
import { SmsGatewayService } from './notifications/sms-gateway.service';
import { CooperativesController } from './cooperatives/cooperatives.controller';
import { CooperativesService } from './cooperatives/cooperatives.service';
import { FarmersModule } from './farmers/farmers.module';
import { AuthModule } from './auth/auth.module';
import { TenantContextInterceptor } from './common/tenant-context.interceptor';
import { OperationsModule } from './operations/operations.module';

@Module({
  imports: [PrismaModule, AuthModule, FarmersModule, OperationsModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
  controllers: [HealthController, CollectionsController, CooperativesController],
  providers: [
    CollectionsService,
    NotificationsService,
    SmsGatewayService,
    CooperativesService,
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
