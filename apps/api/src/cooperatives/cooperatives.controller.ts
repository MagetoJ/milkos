import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { CooperativesService } from './cooperatives.service';
import { ReviewApplicationDto, StartVerificationDto, SubmitApplicationDto, VerifyContactDto } from './dto';

@Controller('cooperatives')
export class CooperativesController {
  constructor(private readonly service: CooperativesService) {}
  @Public() @Post('registration/verify/start') start(@Body() dto:StartVerificationDto,@Req() req:any){return this.service.startVerification(dto,{ip:req.ip,userAgent:req.headers['user-agent']});}
  @Public() @Post('registration/verify/confirm') confirm(@Body() dto:VerifyContactDto,@Req() req:any){return this.service.verifyContact(dto,{ip:req.ip});}
  @Public() @Post('applications') apply(@Body() dto:SubmitApplicationDto,@Req() req:any){return this.service.submitApplication({...dto,applicantUserId:req.user?.sub||'DEV_APPLICANT'},{ip:req.ip,userAgent:req.headers['user-agent'],requestId:req.requestId});}
  @Public() @Get('applications/:reference') status(@Param('reference') reference:string){return this.service.getApplication(reference);}
  @Roles('PLATFORM_SUPER_ADMIN') @Get('applications') list(@Query('status') status?:string){return this.service.listApplications(status);}
  @Roles('PLATFORM_SUPER_ADMIN') @Post('applications/:id/review') review(@Param('id') id:string,@Body() dto:ReviewApplicationDto,@Req() req:any){return this.service.reviewApplication(id,req.user?.sub||'DEV_ADMIN',dto,{ip:req.ip,requestId:req.requestId});}
}
