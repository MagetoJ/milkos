import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export interface AuditContext {
  cooperativeId?: string;
  actorUserId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  result: 'SUCCESS' | 'FAILED' | 'DENIED';
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  correlationId?: string;
  beforeState?: unknown;
  afterState?: unknown;
  metadata?: unknown;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // Inside a tenant transaction RLS only accepts rows for the active cooperative.
  async record(event: AuditContext) {
    return this.prisma.tenantClient.auditEvent.create({ data: {
      ...event,
      cooperativeId: event.cooperativeId ?? this.prisma.currentCooperativeId,
      beforeState: event.beforeState as any,
      afterState: event.afterState as any,
      metadata: event.metadata as any,
    }});
  }

  async security(event: {
    event: string; result: string; reason?: string; ipAddress: string;
    userId?: string; cooperativeId?: string; userAgent?: string; requestId?: string; metadata?: unknown;
  }) {
    return this.prisma.tenantClient.securityEvent.create({ data: {
      ...event,
      cooperativeId: event.cooperativeId ?? this.prisma.currentCooperativeId,
      metadata: event.metadata as any,
    }});
  }
}
