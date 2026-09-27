import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

/** NOLOGIN, NOBYPASSRLS role created by the supabase_auth_rbac migration. */
const TENANT_DB_ROLE = 'milkos_app';

interface TenantTransaction {
  transaction: Prisma.TransactionClient;
  cooperativeId: string;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly transactionContext = new AsyncLocalStorage<TenantTransaction>();
  /**
   * PrismaClient's constructor returns a Proxy that carries the model
   * accessors; inside a getter `this` is the bare target without them, so keep
   * a reference to the proxied client.
   */
  private readonly root: PrismaService;

  constructor() {
    super();
    this.root = this;
  }

  /** Inside a tenant request this is the RLS-bound transaction; otherwise the owner connection. */
  get tenantClient(): Prisma.TransactionClient | PrismaService {
    return this.transactionContext.getStore()?.transaction || this.root;
  }

  get currentCooperativeId(): string | undefined {
    return this.transactionContext.getStore()?.cooperativeId;
  }

  /**
   * Runs `callback` in a transaction that has dropped to the tenant role, so
   * PostgreSQL row-level security applies to every query it makes. The owner
   * role used for the connection bypasses RLS; the switch is what makes the
   * policies enforceable.
   */
  async withTenantContext<T>(cooperativeId: string, callback: () => Promise<T>, userId = ''): Promise<T> {
    const currentTransaction = this.transactionContext.getStore();
    if (currentTransaction) {
      if (currentTransaction.cooperativeId !== cooperativeId) {
        throw new Error('A request cannot switch cooperative context inside a transaction');
      }
      return callback();
    }

    return this.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(`SET LOCAL ROLE ${TENANT_DB_ROLE}`);
      await transaction.$queryRaw`SELECT set_config('app.current_cooperative_id', ${cooperativeId}, true), set_config('app.current_user_id', ${userId}, true)`;
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
