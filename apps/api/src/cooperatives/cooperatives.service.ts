import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SmsGatewayService } from '../notifications/sms-gateway.service';

const hash = (v:string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class CooperativesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sms: SmsGatewayService,
  ) {}

  async startVerification(input:{channel:'PHONE'|'GOOGLE'|'EMAIL';destination:string}, ctx:any) {
    const destination=input.destination.trim().toLowerCase();
    const recent=await this.prisma.tenantClient.registrationVerification.count({where:{destination,channel:input.channel,createdAt:{gte:new Date(Date.now()-10*60_000)}}});
    if(recent>=3) throw new ConflictException('Too many verification attempts. Try again later.');
    const code=input.channel==='GOOGLE' ? null : String(randomInt(100000,999999));
    const record=await this.prisma.tenantClient.registrationVerification.create({data:{channel:input.channel,destination,codeHash:code?hash(code):undefined,expiresAt:new Date(Date.now()+10*60_000),ipAddress:ctx.ip}});
    let delivery = 'verified_externally';
    if (code) {
      try {
        const result = await this.sms.sendVerificationCode(destination, code);
        delivery = result.provider === 'dummy' ? 'simulated' : 'sent';
      } catch (error) {
        await this.prisma.tenantClient.registrationVerification.update({where:{id:record.id},data:{status:'LOCKED'}});
        throw error;
      }
    }
    await this.audit.security({event:'REGISTRATION_VERIFICATION_STARTED',result:'SUCCESS',ipAddress:ctx.ip||'unknown',userAgent:ctx.userAgent,metadata:{channel:input.channel}});
    return {verificationId:record.id,expiresAt:record.expiresAt,delivery};
  }

  async verifyContact(input:{verificationId:string;code:string},ctx:any) {
    const v=await this.prisma.tenantClient.registrationVerification.findUnique({where:{id:input.verificationId}});
    if(!v) throw new NotFoundException('Verification request not found');
    if(v.status!=='PENDING' || v.expiresAt<new Date()) { await this.prisma.tenantClient.registrationVerification.update({where:{id:v.id},data:{status:'EXPIRED'}}); throw new BadRequestException('Verification expired'); }
    if(v.channel==='GOOGLE' || v.codeHash===hash(input.code)) {
      await this.prisma.tenantClient.registrationVerification.update({where:{id:v.id},data:{status:'VERIFIED',verifiedAt:new Date()}});
      await this.audit.security({event:'REGISTRATION_CONTACT_VERIFIED',result:'SUCCESS',ipAddress:ctx.ip||'unknown',metadata:{verificationId:v.id,channel:v.channel}});
      return {verified:true,verificationId:v.id};
    }
    const attempts=v.attempts+1;
    await this.prisma.tenantClient.registrationVerification.update({where:{id:v.id},data:{attempts,status:attempts>=5?'LOCKED':'PENDING'}});
    await this.audit.security({event:'REGISTRATION_VERIFICATION_FAILED',result:'FAILED',reason:'INVALID_CODE',ipAddress:ctx.ip||'unknown',metadata:{verificationId:v.id,attempts}});
    throw new BadRequestException('Invalid verification code');
  }

  async submitApplication(input:any, ctx:any) {
    const phone=input.phone.trim().toLowerCase();
    const verified=await this.prisma.tenantClient.registrationVerification.findFirst({where:{channel:'PHONE',destination:phone,status:'VERIFIED'},orderBy:{verifiedAt:'desc'}});
    if(!verified) throw new ForbiddenException('Verify the phone number before submitting the application');
    const duplicate=await this.prisma.tenantClient.cooperative.findFirst({where:{OR:[{name:{equals:input.name,mode:'insensitive'}},{registrationNumber:input.registrationNumber||undefined}]}});
    if(duplicate) throw new ConflictException('A cooperative with these details already exists');
    const cooperative=await this.prisma.tenantClient.cooperative.create({data:{name:input.name,registrationNumber:input.registrationNumber,currency:input.currency||'KES',status:'PENDING'}});
    const application=await this.prisma.tenantClient.cooperativeApplication.create({data:{cooperativeId:cooperative.id,applicantUserId:input.applicantUserId,reference:`COOP-${new Date().getFullYear()}-${randomUUID().slice(0,8).toUpperCase()}`}});
    await this.prisma.withTenantContext(cooperative.id, () => this.audit.record({cooperativeId:cooperative.id,action:'COOPERATIVE_APPLICATION_SUBMITTED',result:'SUCCESS',entityType:'CooperativeApplication',entityId:application.id,ipAddress:ctx.ip,userAgent:ctx.userAgent,requestId:ctx.requestId,metadata:{reference:application.reference}}));
    return {reference:application.reference,status:application.status,applicationId:application.id};
  }

  async getApplication(reference:string) {
    const app=await this.prisma.tenantClient.cooperativeApplication.findUnique({where:{reference},include:{cooperative:true}});
    if(!app) throw new NotFoundException('Application not found');
    return {reference:app.reference,status:app.status,cooperativeName:app.cooperative.name,submittedAt:app.submittedAt,reviewedAt:app.reviewedAt,notes:app.notes,requestedInformation:app.requestedInformation};
  }

  async listApplications(status?: string) {
    return this.prisma.tenantClient.cooperativeApplication.findMany({
      where: status ? { status: status as any } : undefined,
      include: { cooperative: true },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async reviewApplication(id:string, reviewer:string, input:{status:any;notes?:string}, ctx:any) {
    const app=await this.prisma.tenantClient.cooperativeApplication.findUnique({where:{id},include:{cooperative:true}});
    if(!app) throw new NotFoundException('Application not found');
    if(app.status==='APPROVED' || app.status==='REJECTED') throw new ConflictException('Application is already closed');
    const status=input.status;
    const updated=await this.prisma.withTenantContext(app.cooperativeId, () => this.prisma.transaction(async tx=>{
      const a=await tx.cooperativeApplication.update({where:{id},data:{status,notes:input.notes,requestedInformation:status==='MORE_INFORMATION_REQUIRED'?input.notes:null,reviewedAt:new Date(),reviewedBy:reviewer}});
      await tx.cooperative.update({where:{id:app.cooperativeId},data:{status}});
      if(status==='APPROVED') {
        const existing=await tx.membership.findFirst({where:{cooperativeId:app.cooperativeId,userId:app.applicantUserId}});
        if(!existing) await tx.membership.create({data:{cooperativeId:app.cooperativeId,userId:app.applicantUserId,role:'COOPERATIVE_MANAGER',status:'ACTIVE'}});
      }
      await tx.auditEvent.create({data:{cooperativeId:app.cooperativeId,actorUserId:reviewer,action:`COOPERATIVE_APPLICATION_${status}`,entityType:'CooperativeApplication',entityId:id,result:'SUCCESS',ipAddress:ctx.ip,requestId:ctx.requestId,metadata:{notes:input.notes}}});
      return a;
    }));
    return updated;
  }
}
