import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/auth.decorators';
import { InviteMemberDto, UpdateMembershipDto } from '../auth/dto';
import { MembershipsService } from './memberships.service';
import type { AuthenticatedRequest, AuthPrincipal } from '../auth/auth.types';

@Controller('cooperatives/:cooperativeId/members')
export class MembershipsController {
  constructor(private readonly service: MembershipsService) {}

  @RequirePermissions('members:read')
  @Get()
  list(@Param('cooperativeId', ParseUUIDPipe) cooperativeId: string) {
    return this.service.list(cooperativeId);
  }

  @RequirePermissions('members:manage')
  @Post()
  invite(
    @CurrentUser() actor: AuthPrincipal,
    @Param('cooperativeId', ParseUUIDPipe) cooperativeId: string,
    @Body() dto: InviteMemberDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.invite(actor, cooperativeId, dto, { ip: req.ip, requestId: req.requestId });
  }

  @RequirePermissions('members:manage')
  @Patch(':membershipId')
  update(
    @CurrentUser() actor: AuthPrincipal,
    @Param('cooperativeId', ParseUUIDPipe) cooperativeId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: UpdateMembershipDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.updateStatus(actor, cooperativeId, membershipId, dto.status, { ip: req.ip, requestId: req.requestId });
  }
}
