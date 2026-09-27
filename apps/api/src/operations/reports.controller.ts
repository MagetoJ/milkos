import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { RequirePermissions } from '../auth/auth.decorators';

@RequirePermissions('reports:read')
@Controller('cooperatives/:cooperativeId/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('collections')
  collections(@Param('cooperativeId') cooperativeId: string, @Query('from') from: string, @Query('to') to: string) {
    return this.reports.collections(cooperativeId, from, to);
  }

  @Get('collections.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="milk-collections.csv"')
  collectionsCsv(@Param('cooperativeId') cooperativeId: string, @Query('from') from: string, @Query('to') to: string) {
    return this.reports.collectionsCsv(cooperativeId, from, to);
  }
}