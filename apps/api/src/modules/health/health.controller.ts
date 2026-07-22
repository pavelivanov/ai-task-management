import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import {
  HealthService,
  type HealthStatus,
  type ReadinessStatus,
} from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): HealthStatus {
    return this.healthService.getStatus();
  }

  @Get('ready')
  async getReadiness(): Promise<ReadinessStatus> {
    const status = await this.healthService.getReadiness();
    if (status.status === 'not_ready') {
      throw new ServiceUnavailableException({
        code: 'SERVICE_NOT_READY',
        message: 'The service is not ready to receive traffic.',
        checks: status.checks,
      });
    }
    return status;
  }

  @Get('metrics')
  getMetrics() {
    return this.healthService.getMetrics();
  }
}
