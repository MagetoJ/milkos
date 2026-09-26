import { Body, Controller, Post, Req } from '@nestjs/common';
import { CollectionsService } from './collections.service';

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
}
