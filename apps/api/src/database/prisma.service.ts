import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

import type { DatabasePoolMetrics } from '../common/observability/operational-metrics.service';
import { PrismaClient } from '../generated/prisma/client';
import { AppConfig } from '../config/app-config.service';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: pg.Pool;

  constructor(config: AppConfig) {
    const pool = new pg.Pool({ connectionString: config.databaseUrl });
    super({
      adapter: new PrismaPg(pool, { disposeExternalPool: true }),
      log: config.nodeEnvironment === 'development' ? ['warn', 'error'] : [],
    });
    this.pool = pool;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  getPoolMetrics(): DatabasePoolMetrics {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }
}
