import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [OperationsController, ReportsController],
  providers: [OperationsService, ReportsService],
})
export class OperationsModule {}