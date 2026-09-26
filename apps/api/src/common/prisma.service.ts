import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly transactionContext = new AsyncLocalStorage<{
    transaction: Prisma.TransactionClient;
    cooperativeId: string;
  }>();

  get tenantClient(): Prisma.TransactionClient | PrismaService {
    return this.transactionContext.getStore()?.transaction || this;
  }

  async withTenantContext<T>(cooperativeId: string, callback: () => Promise<T>): Promise<T> {
    const currentTransaction = this.transactionContext.getStore();
    if (currentTransaction) {
      if (currentTransaction.cooperativeId !== cooperativeId) {
        throw new Error('A request cannot switch cooperative context inside a transaction');
      }
      return callback();
    }

    return this.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT set_config('app.current_cooperative_id', ${cooperativeId}, true)`;
      return this.transactionContext.run({ transaction, cooperativeId }, callback);
    }, { maxWait: 5000, timeout: 30000 });
  }

  async transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const currentTransaction = this.transactionContext.getStore()?.transaction;
    if (currentTransaction) return callback(currentTransaction);
    return this.$transaction(callback);
  }

  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
