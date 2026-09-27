import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PrismaService must be a singleton: the tenant transaction lives in its
 * AsyncLocalStorage, so a second instance would silently run queries outside
 * the RLS-bound transaction. Never list PrismaService in a module's providers.
 */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
