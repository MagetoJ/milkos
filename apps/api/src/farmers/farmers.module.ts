import { Module } from '@nestjs/common';
import { FarmersController } from './farmers.controller';
import { FarmersService } from './farmers.service';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [FarmersController],
  providers: [FarmersService, PrismaService],
  exports: [FarmersService],
})
export class FarmersModule {}
