import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
    if (!reason?.trim()) throw new ConflictException('A reason is required');
    const pending = await this.prisma.tenantClient.reversalRequest.findFirst({ where: { collectionId, status: 'PENDING' } });
    if (pending) throw new ConflictException('A reversal request is already pending');

    const reversal = await this.prisma.transaction(async (tx) => {
      const request = await tx.reversalRequest.create({ data: { collectionId, requestedBy, reason: reason.trim(), originalQuantityKg: collection.quantityKg } });
      await tx.milkCollection.update({ where: { id: collectionId }, data: { status: 'REVERSAL_REQUESTED' } });
      return request;
    });
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

  async requestCorrection(collectionId: string, cooperativeId: string, requestedBy: string, quantityKg: number, reason: string, ctx: any) {
    const collection = await this.prisma.tenantClient.milkCollection.findFirst({ where: { id: collectionId, cooperativeId } });
    if (!collection) throw new NotFoundException('Collection not found');
    if (!Number.isFinite(Number(quantityKg)) || Number(quantityKg) <= 0 || !reason?.trim()) {
      throw new BadRequestException('A positive requested quantity and reason are required');
    }
    const pending = await this.prisma.tenantClient.correctionRequest.findFirst({ where: { collectionId, status: 'PENDING' } });
    if (pending) throw new ConflictException('A correction request is already pending');
    const correction = await this.prisma.transaction(async (tx) => {
      const request = await tx.correctionRequest.create({ data: { collectionId, requestedBy, requestedQuantityKg: quantityKg, originalQuantityKg: collection.quantityKg, reason: reason.trim() } });
      await tx.milkCollection.update({ where: { id: collectionId }, data: { status: 'CORRECTION_REQUESTED' } });
      return request;
    });
    await this.audit.record({
      cooperativeId,
      actorUserId: requestedBy,
      action: 'CORRECTION_REQUESTED',
      entityType: 'MilkCollection',
      entityId: collectionId,
      result: 'SUCCESS',
      ipAddress: ctx.ip,
      requestId: ctx.requestId,
      metadata: { correctionId: correction.id, quantityKg, reason },
    });
    return correction;
  }

  listPendingCorrections(cooperativeId: string) {
    return this.prisma.tenantClient.correctionRequest.findMany({
      where: { status: 'PENDING', collection: { cooperativeId } },
      include: { collection: { include: { farmer: true, centre: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async decideCorrection(requestId: string, cooperativeId: string, approver: string, status: 'APPROVED' | 'REJECTED', reason: string | undefined, ctx: any) {
    if (!['APPROVED', 'REJECTED'].includes(status)) throw new ConflictException('Decision must be APPROVED or REJECTED');
    const correction = await this.prisma.tenantClient.correctionRequest.findFirst({
      where: { id: requestId, collection: { cooperativeId } },
      include: { collection: true },
    });
    if (!correction) throw new NotFoundException('Correction request not found');
    if (correction.requestedBy === approver) throw new ForbiddenException('Maker-checker violation: requester cannot approve their own correction');
    if (correction.status !== 'PENDING') throw new ConflictException('Correction is no longer pending');

    return this.prisma.transaction(async (tx) => {
      const updated = await tx.correctionRequest.update({ where: { id: requestId }, data: { status, approvedBy: approver, decidedAt: new Date() } });
      if (status === 'APPROVED') {
        await tx.milkCollection.update({ where: { id: correction.collectionId }, data: { quantityKg: correction.requestedQuantityKg, status: 'CORRECTED' } });
      } else {
        await tx.milkCollection.update({ where: { id: correction.collectionId }, data: { status: 'CONFIRMED' } });
      }
      await tx.auditEvent.create({
        data: {
          cooperativeId,
          actorUserId: approver,
          action: status === 'APPROVED' ? 'CORRECTION_APPROVED' : 'CORRECTION_REJECTED',
          entityType: 'MilkCollection',
          entityId: correction.collectionId,
          result: 'SUCCESS',
          ipAddress: ctx.ip,
          requestId: ctx.requestId,
          metadata: { correctionId: requestId, reason },
        },
      });
      return updated;
    });
  }

  listPendingReversals(cooperativeId: string) {
    return this.prisma.tenantClient.reversalRequest.findMany({
      where: { status: 'PENDING', collection: { cooperativeId } },
      include: { collection: { include: { farmer: true, centre: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async decideReversal(requestId: string, cooperativeId: string, approver: string, status: 'APPROVED' | 'REJECTED', reason: string | undefined, ctx: any) {
    if (status === 'APPROVED') return this.approveReversal(requestId, cooperativeId, approver, ctx);
    if (status !== 'REJECTED') throw new ConflictException('Decision must be APPROVED or REJECTED');
    const reversal = await this.prisma.tenantClient.reversalRequest.findFirst({ where: { id: requestId, collection: { cooperativeId } } });
    if (!reversal) throw new NotFoundException('Reversal request not found');
    if (reversal.requestedBy === approver) throw new ForbiddenException('Maker-checker violation: requester cannot approve their own reversal');
    if (reversal.status !== 'PENDING') throw new ConflictException('Reversal is no longer pending');
    const updated = await this.prisma.tenantClient.reversalRequest.update({ where: { id: requestId }, data: { status, approvedBy: approver, decidedAt: new Date() } });
    await this.prisma.tenantClient.milkCollection.update({ where: { id: reversal.collectionId }, data: { status: 'CONFIRMED' } });
    await this.audit.record({
      cooperativeId,
      actorUserId: approver,
      action: 'REVERSAL_REJECTED',
      entityType: 'MilkCollection',
      entityId: reversal.collectionId,
      result: 'SUCCESS',
      ipAddress: ctx.ip,
      requestId: ctx.requestId,
      metadata: { reversalId: requestId, reason },
    });
    return updated;
  }
}
