import { OperationalMetrics } from '../../common/observability/operational-metrics.service';
import type { PrismaService } from '../../database/prisma.service';

import { HealthService } from './health.service';

describe('HealthService', () => {
  it('returns the stable API health contract', () => {
    const service = new HealthService(
      {} as PrismaService,
      new OperationalMetrics(),
    );

    expect(service.getStatus()).toEqual({
      service: 'api',
      status: 'ok',
    });
  });
});
