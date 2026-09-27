import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, PlatformScope, RequirePermissions } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../auth/auth.types';
import { OperationsService } from './operations.service';

@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @RequirePermissions('coolers:read')
  @Get('cooperatives/:cooperativeId/coolers')
  listCoolers(@Param('cooperativeId') cooperativeId: string) {
    return this.operations.listCoolers(cooperativeId);
  }

  @RequirePermissions('coolers:manage')
  @Post('cooperatives/:cooperativeId/coolers')
  createCooler(@Param('cooperativeId') cooperativeId: string, @Body() body: any) {
    return this.operations.createCooler(cooperativeId, body);
  }

  @RequirePermissions('coolers:manage')
  @Post('cooperatives/:cooperativeId/scales')
  createScale(@Param('cooperativeId') cooperativeId: string, @Body() body: any) {
    return this.operations.createScale(cooperativeId, body);
  }

  @RequirePermissions('pricing:read')
  @Get('cooperatives/:cooperativeId/pricing')
  listPricing(@Param('cooperativeId') cooperativeId: string) {
    return this.operations.listPricing(cooperativeId);
  }

  @RequirePermissions('pricing:manage')
  @Post('cooperatives/:cooperativeId/pricing')
  createPricing(@CurrentUser() user: AuthPrincipal, @Param('cooperativeId') cooperativeId: string, @Body() body: any) {
    return this.operations.createPricing(cooperativeId, body, user.id);
  }

  @PlatformScope()
  @Get('sms/packages')
  listSmsPackages() {
    return this.operations.listSmsPackages();
  }

  @RequirePermissions('sms:read')
  @Get('cooperatives/:cooperativeId/sms/ledger')
  getSmsLedger(@Param('cooperativeId') cooperativeId: string) {
    return this.operations.getSmsLedger(cooperativeId);
  }

  @RequirePermissions('sms:purchase')
  @Post('cooperatives/:cooperativeId/sms/payments')
  submitSmsPayment(@CurrentUser() user: AuthPrincipal, @Param('cooperativeId') cooperativeId: string, @Body() body: any) {
    return this.operations.submitSmsPayment(cooperativeId, body, user.id);
  }

  // Platform staff review payments across cooperatives on the owner connection.
  @PlatformScope()
  @RequirePermissions('platform:payments:verify')
  @Get('admin/payments')
  listPendingPayments(@Query('cooperativeId') cooperativeId: string) {
    return this.operations.listPendingPayments(cooperativeId);
  }

  @PlatformScope()
  @RequirePermissions('platform:payments:verify')
  @Post('admin/payments/:paymentId/decision')
  decidePayment(@CurrentUser() user: AuthPrincipal, @Param('paymentId') paymentId: string, @Body() body: any) {
    return this.operations.decidePayment(paymentId, body, user.id, body.cooperativeId);
  }
}
