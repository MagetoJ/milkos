import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { CurrentUser, PlatformScope, RequirePermissions } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../auth/auth.types';
import { CooperativesService } from './cooperatives.service';
import { ReviewApplicationDto, StartVerificationDto, SubmitApplicationDto, VerifyContactDto } from './dto';

@PlatformScope()
@Controller('cooperatives')
export class CooperativesController {
  constructor(private readonly service: CooperativesService) {}

  @Public()
  @Post('registration/verify/start')
  start(@Body() dto: StartVerificationDto, @Req() req: any) {
    return this.service.startVerification(dto, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Public()
  @Post('registration/verify/confirm')
  confirm(@Body() dto: VerifyContactDto, @Req() req: any) {
    return this.service.verifyContact(dto, { ip: req.ip });
  }

  /** Any signed-in user may apply; they become the cooperative's manager on approval. */
  @Post('applications')
  apply(@CurrentUser() user: AuthPrincipal, @Body() dto: SubmitApplicationDto, @Req() req: any) {
    return this.service.submitApplication(
      { ...dto, applicantUserId: user.id, applicantPhone: user.phone },
      { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.requestId },
    );
  }

  @Public()
  @Get('applications/:reference')
  status(@Param('reference') reference: string) {
    return this.service.getApplication(reference);
  }

  @RequirePermissions('platform:cooperatives:read')
  @Get('applications')
  list(@Query('status') status?: string) {
    return this.service.listApplications(status);
  }

  @RequirePermissions('platform:cooperatives:review')
  @Post('applications/:id/review')
  review(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewApplicationDto, @Req() req: any) {
    return this.service.reviewApplication(id, user.id, dto, {
      ip: req.ip,
      requestId: req.requestId,
    });
  }
}
