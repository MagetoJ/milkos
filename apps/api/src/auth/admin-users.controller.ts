import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { CurrentUser, PlatformScope, RequirePermissions } from './auth.decorators';
import { AdminUsersService } from './admin-users.service';
import { InvitePlatformUserDto, ListUsersQuery, SetPlatformRoleDto, SetUserStatusDto } from './dto';
import type { AuthenticatedRequest, AuthPrincipal } from './auth.types';

@PlatformScope()
@Controller('admin')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @RequirePermissions('platform:users:read')
  @Get('users')
  list(@Query() query: ListUsersQuery) {
    return this.service.list(query.q, query.take);
  }

  @RequirePermissions('platform:cooperatives:read')
  @Get('cooperatives')
  cooperatives() {
    return this.service.listCooperatives();
  }

  @RequirePermissions('platform:users:manage')
  @Post('users/invite')
  invite(@CurrentUser() actor: AuthPrincipal, @Body() dto: InvitePlatformUserDto, @Req() req: AuthenticatedRequest) {
    return this.service.invite(actor, dto, { ip: req.ip, requestId: req.requestId });
  }

  @RequirePermissions('platform:users:manage')
  @Patch('users/:id/platform-role')
  setRole(@CurrentUser() actor: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPlatformRoleDto, @Req() req: AuthenticatedRequest) {
    return this.service.setPlatformRole(actor, id, dto.platformRole ?? null, { ip: req.ip, requestId: req.requestId });
  }

  @RequirePermissions('platform:users:manage')
  @Patch('users/:id/status')
  setStatus(@CurrentUser() actor: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetUserStatusDto, @Req() req: AuthenticatedRequest) {
    return this.service.setStatus(actor, id, dto.status, { ip: req.ip, requestId: req.requestId });
  }
}
