import { Body, Controller, Post, Req } from '@nestjs/common';
import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { CollectionsService } from './collections.service';

class CreateCollectionDto {
  @IsString() cooperativeId!: string;
  @IsString() farmerId!: string;
  @IsString() centreId!: string;
  @IsNumber() @Min(0) quantityKg!: number;
  @IsOptional() @IsNumber() @Min(0) quantityLitres?: number;
  @IsDateString() collectedAt!: string;
  @IsOptional() @IsDateString() offlineCreatedAt?: string;
  @IsOptional() @IsString() scaleDeviceId?: string;
  @IsString() idempotencyKey!: string;
  @IsString() referenceNumber!: string;
}

@Controller('collections')
export class CollectionsController {
  constructor(private readonly service: CollectionsService) {}
  @Post() create(@Body() dto: CreateCollectionDto, @Req() req: any) {
    return this.service.create({ ...dto, collectedAt: new Date(dto.collectedAt), offlineCreatedAt: dto.offlineCreatedAt ? new Date(dto.offlineCreatedAt) : undefined, collectorUserId: req.user?.sub || 'DEV_COLLECTOR' }, { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.requestId });
  }
  @Post('reversal-requests') requestReversal(@Body() body: { collectionId: string; cooperativeId: string; reason: string }, @Req() req: any) {
    return this.service.requestReversal(body.collectionId, body.cooperativeId, req.user?.sub || 'DEV_USER', body.reason, { ip: req.ip, requestId: req.requestId });
  }
  @Post('reversal-approvals') approveReversal(@Body() body: { reversalId: string; cooperativeId: string }, @Req() req: any) {
    return this.service.approveReversal(body.reversalId, body.cooperativeId, req.user?.sub || 'DEV_APPROVER', { ip: req.ip, requestId: req.requestId });
  }
}
