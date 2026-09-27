import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentVerificationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  listCoolers(cooperativeId: string) {
    return this.prisma.tenantClient.cooler.findMany({
      where: { cooperativeId },
      include: { centre: true, scaleDevices: true },
      orderBy: { name: 'asc' },
    });
  }

  createCooler(cooperativeId: string, input: { name: string; serialNumber: string; centreId?: string; locationLabel?: string }) {
    if (!input.name?.trim() || !input.serialNumber?.trim()) throw new BadRequestException('Name and serial number are required');
    if (input.centreId) {
      return this.prisma.tenantClient.collectionCentre.findFirst({ where: { id: input.centreId, cooperativeId, active: true } }).then((centre) => {
        if (!centre) throw new NotFoundException('Collection centre not found in cooperative');
        return this.prisma.tenantClient.cooler.create({
          data: { cooperativeId, name: input.name.trim(), serialNumber: input.serialNumber.trim(), centreId: input.centreId, locationLabel: input.locationLabel?.trim() || undefined },
        });
      });
    }
    return this.prisma.tenantClient.cooler.create({
      data: { cooperativeId, name: input.name.trim(), serialNumber: input.serialNumber.trim(), centreId: input.centreId || undefined, locationLabel: input.locationLabel?.trim() || undefined },
    });
  }

  async createScale(cooperativeId: string, input: { deviceIdentifier: string; serialNumber?: string; centreId?: string; coolerId?: string }) {
    if (!input.deviceIdentifier?.trim()) throw new BadRequestException('Device identifier is required');
    if (input.centreId) {
      const centre = await this.prisma.tenantClient.collectionCentre.findFirst({ where: { id: input.centreId, cooperativeId, active: true } });
      if (!centre) throw new NotFoundException('Collection centre not found in cooperative');
    }
    if (input.coolerId) {
      const cooler = await this.prisma.tenantClient.cooler.findFirst({ where: { id: input.coolerId, cooperativeId } });
      if (!cooler) throw new NotFoundException('Cooler not found in cooperative');
    }
    return this.prisma.tenantClient.scaleDevice.create({
      data: { cooperativeId, deviceIdentifier: input.deviceIdentifier.trim(), serialNumber: input.serialNumber?.trim() || undefined, centreId: input.centreId || undefined, coolerId: input.coolerId || undefined },
    });
  }

  listPricing(cooperativeId: string) {
    return this.prisma.tenantClient.milkPricing.findMany({
      where: { cooperativeId },
      include: { cooler: true },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async createPricing(cooperativeId: string, input: { coolerId?: string; effectiveFrom: string; effectiveTo?: string; pricePerKg: number; currency?: string }, createdBy: string) {
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
    const price = Number(input.pricePerKg);
    if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && Number.isNaN(effectiveTo.getTime())) || !Number.isFinite(price) || price <= 0) {
      throw new BadRequestException('Provide valid effective dates and a positive price per KG');
    }
    if (effectiveTo && effectiveTo <= effectiveFrom) throw new BadRequestException('Effective end must be after effective start');
    if (input.coolerId) {
      const cooler = await this.prisma.tenantClient.cooler.findFirst({ where: { id: input.coolerId, cooperativeId } });
      if (!cooler) throw new NotFoundException('Cooler not found in cooperative');
    }
    const overlap = await this.prisma.tenantClient.milkPricing.findFirst({
      where: {
        cooperativeId,
        coolerId: input.coolerId || null,
        effectiveFrom: { lt: effectiveTo || new Date('9999-12-31T23:59:59.999Z') },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
      },
    });
    if (overlap) throw new ConflictException('A pricing schedule already overlaps these effective dates');
    return this.prisma.tenantClient.milkPricing.create({
      data: { cooperativeId, coolerId: input.coolerId || undefined, effectiveFrom, effectiveTo, pricePerKg: new Prisma.Decimal(price), currency: input.currency || 'KES', createdBy },
    });
  }

  listSmsPackages() {
    return this.prisma.smsPackage.findMany({ where: { active: true }, orderBy: { price: 'asc' } });
  }

  async getSmsLedger(cooperativeId: string) {
    const entries = await this.prisma.tenantClient.smsLedgerEntry.findMany({ where: { cooperativeId }, orderBy: { createdAt: 'desc' }, take: 100 });
    const totals = await this.prisma.tenantClient.smsLedgerEntry.aggregate({ where: { cooperativeId }, _sum: { credits: true } });
    return { balance: totals._sum.credits || 0, entries };
  }

  async submitSmsPayment(cooperativeId: string, input: { packageId: string; mpesaReference: string; amountPaid: number; payerPhone: string }, submittedBy: string) {
    const smsPackage = await this.prisma.smsPackage.findFirst({ where: { id: input.packageId, active: true } });
    if (!smsPackage) throw new NotFoundException('SMS package not found');
    if (!input.mpesaReference?.trim() || !input.payerPhone?.trim() || Number(input.amountPaid) !== Number(smsPackage.price)) {
      throw new BadRequestException('M-Pesa reference, payer phone, and exact package amount are required');
    }
    return this.prisma.tenantClient.paymentVerification.create({
      data: { cooperativeId, packageId: input.packageId, mpesaReference: input.mpesaReference.trim().toUpperCase(), amountPaid: new Prisma.Decimal(input.amountPaid), payerPhone: input.payerPhone.trim(), submittedBy },
      include: { smsPackage: true },
    });
  }

  listPendingPayments(cooperativeId: string) {
    if (!cooperativeId) throw new BadRequestException('cooperativeId query parameter is required for tenant-scoped review');
    return this.prisma.paymentVerification.findMany({
      where: { cooperativeId, status: PaymentVerificationStatus.PENDING },
      include: { cooperative: { select: { id: true, name: true } }, smsPackage: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async decidePayment(paymentId: string, input: { status: 'APPROVED' | 'REJECTED'; rejectionReason?: string }, verifiedBy: string, cooperativeId: string) {
    if (!cooperativeId) throw new BadRequestException('cooperativeId is required for tenant-scoped review');
    if (!['APPROVED', 'REJECTED'].includes(input.status)) throw new BadRequestException('Decision must be APPROVED or REJECTED');
    const existing = await this.prisma.paymentVerification.findFirst({ where: { id: paymentId, cooperativeId }, include: { smsPackage: true } });
    if (!existing) throw new NotFoundException('Payment verification not found');
    if (existing.status !== PaymentVerificationStatus.PENDING) throw new ConflictException('Payment has already been decided');
    if (input.status === 'REJECTED' && !input.rejectionReason?.trim()) throw new BadRequestException('A rejection reason is required');

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentVerification.update({
        where: { id: paymentId, cooperativeId },
        data: { status: input.status, verifiedBy, rejectionReason: input.status === 'REJECTED' ? input.rejectionReason!.trim() : null, decidedAt: new Date() },
      });
      if (input.status === 'APPROVED') {
        await tx.smsLedgerEntry.create({
          data: {
            cooperativeId: existing.cooperativeId,
            type: 'PURCHASE',
            credits: existing.smsPackage.smsCount,
            amount: existing.amountPaid,
            reference: existing.mpesaReference,
            idempotencyKey: `payment:${existing.id}`,
            packageId: existing.packageId,
            paymentVerificationId: existing.id,
            createdBy: verifiedBy,
          },
        });
      }
      return payment;
    });
  }
}