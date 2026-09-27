import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { OperationsService } from './operations.service';

@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('cooperatives/:cooperativeId/coolers')
  listCoolers(@Param('cooperativeId') cooperativeId: string) {
    return this.operations.listCoolers(cooperativeId);
  }

  @Post('cooperatives/:cooperativeId/coolers')
  createCooler(@Param('cooperativeId') cooperativeId: string, @Body() body: any) {
    return this.operations.createCooler(cooperativeId, body);
  }

  @Post('cooperatives/:cooperativeId/scales')
  createScale(@Param('cooperativeId') cooperativeId: string, @Body() body: any) {
    return this.operations.createScale(cooperativeId, body);
  }

  @Get('cooperatives/:cooperativeId/pricing')
  listPricing(@Param('cooperativeId') cooperativeId: string) {
    return this.operations.listPricing(cooperativeId);
  }

  @Post('cooperatives/:cooperativeId/pricing')
  createPricing(@Param('cooperativeId') cooperativeId: string, @Body() body: any, @Req() req: any) {
    return this.operations.createPricing(cooperativeId, body, req.user?.sub || 'UNKNOWN_USER');
  }

  @Get('sms/packages')
  listSmsPackages() {
    return this.operations.listSmsPackages();
  }

  @Get('cooperatives/:cooperativeId/sms/ledger')
  getSmsLedger(@Param('cooperativeId') cooperativeId: string) {
    return this.operations.getSmsLedger(cooperativeId);
  }

  @Post('cooperatives/:cooperativeId/sms/payments')
  submitSmsPayment(@Param('cooperativeId') cooperativeId: string, @Body() body: any, @Req() req: any) {
    return this.operations.submitSmsPayment(cooperativeId, body, req.user?.sub || 'UNKNOWN_USER');
  }

  @Roles('PLATFORM_ADMIN', 'PLATFORM_SUPER_ADMIN')
  @Get('admin/payments')
  listPendingPayments(@Query('cooperativeId') cooperativeId: string) {
    return this.operations.listPendingPayments(cooperativeId);
  }

  @Roles('PLATFORM_ADMIN', 'PLATFORM_SUPER_ADMIN')
  @Post('admin/payments/:paymentId/decision')
  decidePayment(@Param('paymentId') paymentId: string, @Body() body: any, @Req() req: any) {
    return this.operations.decidePayment(paymentId, body, req.user?.sub || 'UNKNOWN_ADMIN', body.cooperativeId);
  }
}