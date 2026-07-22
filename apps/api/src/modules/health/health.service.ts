import { Injectable } from '@nestjs/common';

import { OperationalMetrics } from '../../common/observability/operational-metrics.service';
import { PrismaService } from '../../database/prisma.service';

const requiredMigration = '20260721160000_behavior_notifications';

export interface HealthStatus {
  service: 'api';
  status: 'ok';
}

export interface ReadinessStatus {
  service: 'api';
  status: 'ready' | 'not_ready';
  checks: { database: 'ok' | 'failed'; migrations: 'ok' | 'failed' };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: OperationalMetrics,
  ) {}

  getStatus(): HealthStatus {
    return {
      service: 'api',
      status: 'ok',
    };
  }

  async getReadiness(): Promise<ReadinessStatus> {
    const startedAt = performance.now();
    try {
      const result = await this.prisma.$queryRaw<
        Array<{
          databaseReady: boolean;
          migrationFailures: number;
          requiredMigrationApplied: boolean;
        }>
      >`
        SELECT
          true AS "databaseReady",
          (
            SELECT COUNT(*)::int
            FROM "_prisma_migrations"
            WHERE finished_at IS NULL AND rolled_back_at IS NULL
          ) AS "migrationFailures",
          EXISTS (
            SELECT 1
            FROM "_prisma_migrations"
            WHERE migration_name = ${requiredMigration}
              AND finished_at IS NOT NULL
              AND rolled_back_at IS NULL
          ) AS "requiredMigrationApplied"
      `;
      const databaseReady = result[0]?.databaseReady === true;
      const migrationsReady =
        result[0]?.migrationFailures === 0 &&
        result[0]?.requiredMigrationApplied === true;
      const ready = databaseReady && migrationsReady;
      this.metrics.recordDatabaseProbe(ready, performance.now() - startedAt);
      return {
        service: 'api',
        status: ready ? 'ready' : 'not_ready',
        checks: {
          database: databaseReady ? 'ok' : 'failed',
          migrations: migrationsReady ? 'ok' : 'failed',
        },
      };
    } catch {
      this.metrics.recordDatabaseProbe(false, performance.now() - startedAt);
      return {
        service: 'api',
        status: 'not_ready',
        checks: { database: 'failed', migrations: 'failed' },
      };
    }
  }

  getMetrics() {
    return this.metrics.snapshot(this.prisma.getPoolMetrics());
  }
}
