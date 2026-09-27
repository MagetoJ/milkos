import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { CurrentTenant, CurrentUser, RequirePermissions } from '../auth/auth.decorators';
import type { AuthPrincipal, RequestTenant } from '../auth/auth.types';

@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @RequirePermissions('collections:create')
  @Post()
  createCollection(@CurrentUser() user: AuthPrincipal, @CurrentTenant() tenant: RequestTenant, @Body() dto: any, @Req() req: any) {
    // The collector is always the caller; the cooperative is the one the guard authorized.
    return this.collectionsService.recordCollection({ ...dto, cooperativeId: tenant.cooperativeId, collectorUserId: user.id }, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });
  }

  @RequirePermissions('corrections:request')
  @Post(':collectionId/corrections')
  requestCorrection(@CurrentUser() user: AuthPrincipal, @CurrentTenant() tenant: RequestTenant, @Param('collectionId') collectionId: string, @Body() body: any, @Req() req: any) {
    return this.collectionsService.requestCorrection(collectionId, tenant.cooperativeId, user.id, body.quantityKg, body.reason, {
      ip: req.ip,
      requestId: req.requestId,
    });
  }

  @RequirePermissions('corrections:decide')
  @Get('corrections/pending')
  listPendingCorrections(@CurrentTenant() tenant: RequestTenant) {
    return this.collectionsService.listPendingCorrections(tenant.cooperativeId);
  }

  @RequirePermissions('corrections:decide')
  @Post('corrections/:requestId/decision')
  decideCorrection(@CurrentUser() user: AuthPrincipal, @CurrentTenant() tenant: RequestTenant, @Param('requestId') requestId: string, @Body() body: any, @Req() req: any) {
    return this.collectionsService.decideCorrection(requestId, tenant.cooperativeId, user.id, body.status, body.reason, {
      ip: req.ip,
      requestId: req.requestId,
    });
  }

  @RequirePermissions('reversals:request')
  @Post(':collectionId/reversals')
  requestReversal(@CurrentUser() user: AuthPrincipal, @CurrentTenant() tenant: RequestTenant, @Param('collectionId') collectionId: string, @Body() body: any, @Req() req: any) {
    return this.collectionsService.requestReversal(collectionId, tenant.cooperativeId, user.id, body.reason, {
      ip: req.ip,
      requestId: req.requestId,
    });
  }

  @RequirePermissions('reversals:decide')
  @Get('reversals/pending')
  listPendingReversals(@CurrentTenant() tenant: RequestTenant) {
    return this.collectionsService.listPendingReversals(tenant.cooperativeId);
  }

  @RequirePermissions('reversals:decide')
  @Post('reversals/:requestId/decision')
  decideReversal(@CurrentUser() user: AuthPrincipal, @CurrentTenant() tenant: RequestTenant, @Param('requestId') requestId: string, @Body() body: any, @Req() req: any) {
    return this.collectionsService.decideReversal(requestId, tenant.cooperativeId, user.id, body.status, body.reason, {
      ip: req.ip,
      requestId: req.requestId,
    });
  }
}
