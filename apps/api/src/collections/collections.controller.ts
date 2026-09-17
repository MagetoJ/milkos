import { Body, Controller, Post, Req } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { CollectionsService } from './collections.service';

@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Public()
  @Post()
  createCollection(@Body() dto: any, @Req() req: any) {
    return this.collectionsService.recordCollection(dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });
  }
}
