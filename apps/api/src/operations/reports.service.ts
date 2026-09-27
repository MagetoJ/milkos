import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getCollections(cooperativeId: string, from: string, to: string) {
    const start = new Date(from);
    const end = new Date(to);
    if (!from || !to || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      throw new BadRequestException('Valid from and to dates are required');
    }
    if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Report date range cannot exceed 366 days');
    }
    end.setUTCHours(23, 59, 59, 999);
    const records = await this.prisma.tenantClient.milkCollection.findMany({
      where: { cooperativeId, collectedAt: { gte: start, lte: end }, deletedAt: null, status: { not: 'REVERSED' } },
      include: { farmer: true, centre: true },
      orderBy: { collectedAt: 'asc' },
    });
    return records;
  }

  async collections(cooperativeId: string, from: string, to: string) {
    const records = await this.getCollections(cooperativeId, from, to);
    const farmers = new Map<string, { farmerId: string; farmerName: string; memberNumber: string; quantityKg: number; collections: number }>();
    const centres = new Map<string, { centreId: string; centreName: string; quantityKg: number; collections: number }>();
    let totalKg = 0;
    for (const record of records) {
      const kg = Number(record.quantityKg);
      totalKg += kg;
      const farmer = farmers.get(record.farmerId) || { farmerId: record.farmerId, farmerName: record.farmer.fullName, memberNumber: record.farmer.memberNumber, quantityKg: 0, collections: 0 };
      farmer.quantityKg += kg;
      farmer.collections += 1;
      farmers.set(record.farmerId, farmer);
      const centre = centres.get(record.centreId) || { centreId: record.centreId, centreName: record.centre.name, quantityKg: 0, collections: 0 };
      centre.quantityKg += kg;
      centre.collections += 1;
      centres.set(record.centreId, centre);
    }
    return {
      from,
      to,
      totalKg: Math.round(totalKg * 1000) / 1000,
      collectionCount: records.length,
      farmerCount: farmers.size,
      farmers: [...farmers.values()].sort((left, right) => right.quantityKg - left.quantityKg),
      centres: [...centres.values()].sort((left, right) => right.quantityKg - left.quantityKg),
    };
  }

  async collectionsCsv(cooperativeId: string, from: string, to: string) {
    const records = await this.getCollections(cooperativeId, from, to);
    const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const lines = [
      ['Reference', 'Collected at', 'Farmer', 'Member number', 'Centre', 'Quantity KG', 'Status'].map(escape).join(','),
      ...records.map((record) => [record.referenceNumber, record.collectedAt.toISOString(), record.farmer.fullName, record.farmer.memberNumber, record.centre.name, Number(record.quantityKg).toFixed(3), record.status].map(escape).join(',')),
    ];
    return `\uFEFF${lines.join('\r\n')}`;
  }
}