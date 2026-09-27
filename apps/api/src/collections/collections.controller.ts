import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { CurrentUser, RequirePermissions } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../auth/auth.types';

@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @RequirePermissions('collections:create')
  @Post()
  createCollection(@Body() dto: any, @CurrentUser() user: AuthPrincipal, @Req() req: any) {
    // The collector is always the caller, never a client-supplied id.
    return this.collectionsService.recordCollection({ ...dto, cooperativeId: req.tenant.cooperativeId, collectorUserId: user.id }, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });
  }

  @RequirePermissions('corrections:request')
  @Post(':collectionId/corrections')
  requestCorrection(@Param('collectionId') collectionId: string, @Body() body: any, @CurrentUser() user: AuthPrincipal, @Req() req: any) {
    return this.collectionsService.requestCorrection(collectionId, req.tenant.cooperativeId, user.id, body.quantityKg, body.reason, {
      ip: req.ip,
      requestId: req.requestId,
    });
  }

  @RequirePermissions('corrections:decide')
  @Get('corrections/pending')
  listPendingCorrections(@Req() req: any) {
    return this.collectionsService.listPendingCorrections(req.tenant?.cooperativeId);
  }

  @Post('corrections/:requestId/decision')
  @RequirePermissions('corrections:decide')
  decideCorrection(@Param('requestId') requestId: string, @Body() body: any, @CurrentUser() user: AuthPrincipal, @Req() req: any) {
    return this.collectionsService.decideCorrection(requestId, req.tenant.cooperativeId, user.id, body.status, body.reason, {
      ip: req.ip,
      requestId: req.requestId,
    });
  }

  @RequirePermissions('reversals:request')
  @Post(':collectionId/reversals')
  requestReversal(@Param('collectionId') collectionId: string, @Body() body: any, @CurrentUser() user: AuthPrincipal, @Req() req: any) {
    return this.collectionsService.requestReversal(collectionId, req.tenant.cooperativeId, user.id, body.reason, {
      ip: req.ip,
      requestId: req.requestId,
    });
  }

  @RequirePermissions('reversals:decide')
  @Get('reversals/pending')
  listPendingReversals(@Req() req: any) {
    return this.collectionsService.listPendingReversals(req.tenant?.cooperativeId);
  }

  @Post('reversals/:requestId/decision')
  @RequirePermissions('reversals:decide')
  decideReversal(@Param('requestId') requestId: string, @Body() body: any, @CurrentUser() user: AuthPrincipal, @Req() req: any) {
    return this.collectionsService.decideReversal(requestId, req.tenant.cooperativeId, user.id, body.status, body.reason, {
      ip: req.ip,
      requestId: req.requestId,
    });
  }
}
