import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async recordCollection(
    input: {
      cooperativeId: string;
      farmerId: string;
      collectorUserId: string;
      centreId: string;
      quantityKg: number;
      quantityLitres?: number;
      collectedAt: Date;
      offlineCreatedAt?: Date;
      scaleDeviceId?: string;
      idempotencyKey: string;
      referenceNumber: string;
    },
    ctx: { ip?: string; requestId?: string; userAgent?: string },
  ) {
    return this.create(input, ctx);
  }

  async create(
    input: {
      cooperativeId: string;
      farmerId: string;
      collectorUserId: string;
      centreId: string;
      quantityKg: number;
      quantityLitres?: number;
      collectedAt: Date;
      offlineCreatedAt?: Date;
      scaleDeviceId?: string;
      idempotencyKey: string;
      referenceNumber: string;
    },
    ctx: { ip?: string; requestId?: string; userAgent?: string },
  ) {
    const existing = await this.prisma.tenantClient.milkCollection.findUnique({
      where: {
        cooperativeId_idempotencyKey: {
          cooperativeId: input.cooperativeId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) return existing;

    const farmer = await this.prisma.tenantClient.farmer.findFirst({
      where: { id: input.farmerId, cooperativeId: input.cooperativeId, active: true, deletedAt: null },
    });
    if (!farmer) throw new NotFoundException('Active farmer not found in cooperative');

    const centre = await this.prisma.tenantClient.collectionCentre.findFirst({
      where: { id: input.centreId, cooperativeId: input.cooperativeId, active: true },
    });
    if (!centre) throw new NotFoundException('Collection centre not found in cooperative');

    try {
      const collection = await this.prisma.transaction(async (tx) => {
        const record = await tx.milkCollection.create({
          data: {
            cooperativeId: input.cooperativeId,
            farmerId: input.farmerId,
            collectorUserId: input.collectorUserId,
            centreId: input.centreId,
            quantityKg: input.quantityKg,
            quantityLitres: input.quantityLitres,
            collectedAt: input.collectedAt,
            offlineCreatedAt: input.offlineCreatedAt,
            scaleDeviceId: input.scaleDeviceId,
            idempotencyKey: input.idempotencyKey,
            referenceNumber: input.referenceNumber,
            status: 'CONFIRMED',
            syncStatus: 'SYNCED',
          },
        });
        await tx.auditEvent.create({
          data: {
            cooperativeId: input.cooperativeId,
            actorUserId: input.collectorUserId,
            action: 'COLLECTION_CREATED',
            entityType: 'MilkCollection',
            entityId: record.id,
            result: 'SUCCESS',
            ipAddress: ctx.ip,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
            afterState: {
              quantityKg: input.quantityKg,
              farmerId: input.farmerId,
              referenceNumber: input.referenceNumber,
            },
          },
        });
        return record;
      });

      await this.notifications.queueReceipt(
        collection.id,
        input.cooperativeId,
        farmer.phone,
        `Milk receipt ${collection.referenceNumber}: ${input.quantityKg} KG.`,
      );
      return collection;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const duplicate = await this.prisma.tenantClient.milkCollection.findUnique({
          where: {
            cooperativeId_idempotencyKey: {
              cooperativeId: input.cooperativeId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (duplicate) return duplicate;
        throw new ConflictException('Duplicate collection reference');
      }
      await this.audit.record({
        cooperativeId: input.cooperativeId,
        actorUserId: input.collectorUserId,
        action: 'COLLECTION_CREATE_FAILED',
        entityType: 'MilkCollection',
        result: 'FAILED',
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: { message: e?.message },
      });
      throw e;
    }
  }

  async requestReversal(collectionId: string, cooperativeId: string, requestedBy: string, reason: string, ctx: any) {
    const collection = await this.prisma.tenantClient.milkCollection.findFirst({ where: { id: collectionId, cooperativeId } });
    if (!collection) throw new NotFoundException('Collection not found');

    const reversal = await this.prisma.tenantClient.reversalRequest.create({ data: { collectionId, requestedBy, reason } });
    await this.audit.record({
      cooperativeId,
      actorUserId: requestedBy,
      action: 'REVERSAL_REQUESTED',
      entityType: 'MilkCollection',
      entityId: collectionId,
      result: 'SUCCESS',
      ipAddress: ctx.ip,
      requestId: ctx.requestId,
      metadata: { reversalId: reversal.id, reason },
    });
    return reversal;
  }

  async approveReversal(reversalId: string, cooperativeId: string, approver: string, ctx: any) {
    const reversal = await this.prisma.tenantClient.reversalRequest.findFirst({
      where: { id: reversalId, collection: { cooperativeId } },
      include: { collection: true },
    });
    if (!reversal) throw new NotFoundException('Reversal request not found');
    if (reversal.requestedBy === approver) {
      throw new ForbiddenException('Maker-checker violation: requester cannot approve their own reversal');
    }
    if (reversal.status !== 'PENDING') throw new ConflictException('Reversal is no longer pending');

    const updated = await this.prisma.transaction(async (tx) => {
      const r = await tx.reversalRequest.update({
        where: { id: reversalId },
        data: { status: 'APPROVED', approvedBy: approver, decidedAt: new Date() },
      });
      await tx.milkCollection.update({ where: { id: reversal.collectionId }, data: { status: 'REVERSED' } });
      await tx.auditEvent.create({
        data: {
          cooperativeId,
          actorUserId: approver,
          action: 'REVERSAL_APPROVED',
          entityType: 'MilkCollection',
          entityId: reversal.collectionId,
          result: 'SUCCESS',
          ipAddress: ctx.ip,
          requestId: ctx.requestId,
          metadata: { reversalId },
        },
      });
      return r;
    });
    return updated;
  }
}
