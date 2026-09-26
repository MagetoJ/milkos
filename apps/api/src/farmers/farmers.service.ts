import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class FarmersService {
  constructor(private readonly prisma: PrismaService) {}

  async createFarmer(cooperativeId: string, data: { memberNumber: string; fullName: string; phone: string; centreId?: string }) {
    const existing = await this.prisma.farmer.findUnique({
      where: { cooperativeId_memberNumber: { cooperativeId, memberNumber: data.memberNumber } },
    });
    if (existing) throw new ConflictException('Member number already exists in this cooperative');

    return this.prisma.farmer.create({
      data: {
        cooperativeId,
        memberNumber: data.memberNumber,
        fullName: data.fullName,
        phone: data.phone,
        centreId: data.centreId || undefined,
      },
    });
  }

  async getFarmers(cooperativeId: string) {
    return this.prisma.farmer.findMany({
      where: { cooperativeId, active: true },
      include: { centre: true },
      orderBy: { fullName: 'asc' },
    });
  }

}
