import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './common/prisma.service';
import { AuditService } from './audit/audit.service';
import { HealthController } from './health/health.controller';
import { CollectionsController } from './collections/collections.controller';
import { CollectionsService } from './collections/collections.service';
import { NotificationsService } from './notifications/notifications.service';
import { CooperativesController } from './cooperatives/cooperatives.controller';
import { CooperativesService } from './cooperatives/cooperatives.service';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [AuthModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
  controllers: [HealthController, CollectionsController, CooperativesController],
  providers: [PrismaService, AuditService, CollectionsService, NotificationsService, CooperativesService],
})
export class AppModule {}
