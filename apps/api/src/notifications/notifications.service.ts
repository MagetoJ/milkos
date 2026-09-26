import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(private readonly prisma: PrismaService) {}

  async queueReceipt(collectionId: string, cooperativeId: string, recipient: string, message: string) {
    const n = await this.prisma.tenantClient.notification.create({ data: { collectionId, cooperativeId, recipient, message, channel: 'SMS', status: 'QUEUED' } });
    this.logger.log(`Notification queued: ${n.id}`);
    return n;
  }

  async processDummy(notificationId: string, cooperativeId: string, simulateFailure = false) {
    return this.prisma.withTenantContext(cooperativeId, async () => {
      const n = await this.prisma.tenantClient.notification.findFirst({ where: { id: notificationId, cooperativeId } });
      if (!n) throw new Error('Notification not found in cooperative');
      const attemptNumber = n.attempts + 1;
      if (simulateFailure) {
        return this.prisma.transaction(async tx => {
          await tx.notificationAttempt.create({ data: { notificationId, attemptNumber, status: 'FAILED', errorCode: 'DUMMY_FAILURE', errorMessage: 'Simulated provider failure' } });
          return tx.notification.update({ where: { id: notificationId }, data: { attempts: attemptNumber, status: attemptNumber >= 4 ? 'MANUAL_RETRY' : 'FAILED', lastError: 'Simulated provider failure', nextAttemptAt: attemptNumber >= 4 ? null : new Date(Date.now() + Math.min(30 * 2 ** (attemptNumber - 1), 1800) * 1000) } });
        });
      }
      return this.prisma.transaction(async tx => {
        await tx.notificationAttempt.create({ data: { notificationId, attemptNumber, status: 'SENT', providerResponse: 'DUMMY_EMAIL_PROVIDER' } });
        return tx.notification.update({ where: { id: notificationId }, data: { attempts: attemptNumber, status: 'SENT', sentAt: new Date(), providerMessageId: `DUMMY-${notificationId}` } });
      });
    });
  }
}
