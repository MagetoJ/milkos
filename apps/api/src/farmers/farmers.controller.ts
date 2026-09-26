import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { FarmersService } from './farmers.service';

@Controller('cooperatives/:cooperativeId/farmers')
export class FarmersController {
  constructor(private readonly farmersService: FarmersService) {}

  @Post()
  create(
    @Param('cooperativeId') cooperativeId: string,
    @Body() dto: { memberNumber: string; fullName: string; phone: string; centreId?: string },
  ) {
    return this.farmersService.createFarmer(cooperativeId, dto);
  }

  @Get()
  list(@Param('cooperativeId') cooperativeId: string) {
    return this.farmersService.getFarmers(cooperativeId);
  }
}
