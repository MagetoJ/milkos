import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { Roles } from '../auth/roles.decorator';

@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Post()
  createCollection(@Body() dto: any, @Req() req: any) {
    return this.collectionsService.recordCollection(dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });
  }

  @Post(':collectionId/corrections')
  requestCorrection(@Param('collectionId') collectionId: string, @Body() body: any, @Req() req: any) {
    return this.collectionsService.requestCorrection(collectionId, body.cooperativeId, req.user?.sub, body.quantityKg, body.reason, {
      ip: req.ip,
      requestId: req.requestId,
    });
  }

  @Get('corrections/pending')
  listPendingCorrections(@Req() req: any) {
    return this.collectionsService.listPendingCorrections(req.tenant?.cooperativeId);
  }

  @Post('corrections/:requestId/decision')
  @Roles('COOPERATIVE_MANAGER', 'PLATFORM_ADMIN', 'PLATFORM_SUPER_ADMIN')
  decideCorrection(@Param('requestId') requestId: string, @Body() body: any, @Req() req: any) {
    return this.collectionsService.decideCorrection(requestId, req.tenant?.cooperativeId, req.user?.sub, body.status, body.reason, {
      ip: req.ip,
      requestId: req.requestId,
    });
  }

  @Post(':collectionId/reversals')
  requestReversal(@Param('collectionId') collectionId: string, @Body() body: any, @Req() req: any) {
    return this.collectionsService.requestReversal(collectionId, body.cooperativeId, req.user?.sub, body.reason, {
      ip: req.ip,
      requestId: req.requestId,
    });
  }

  @Get('reversals/pending')
  listPendingReversals(@Req() req: any) {
    return this.collectionsService.listPendingReversals(req.tenant?.cooperativeId);
  }

  @Post('reversals/:requestId/decision')
  @Roles('COOPERATIVE_MANAGER', 'PLATFORM_ADMIN', 'PLATFORM_SUPER_ADMIN')
  decideReversal(@Param('requestId') requestId: string, @Body() body: any, @Req() req: any) {
    return this.collectionsService.decideReversal(requestId, req.tenant?.cooperativeId, req.user?.sub, body.status, body.reason, {
      ip: req.ip,
      requestId: req.requestId,
    });
  }
}
