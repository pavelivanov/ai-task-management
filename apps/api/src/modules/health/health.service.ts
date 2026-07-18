import { Injectable } from '@nestjs/common';

export interface HealthStatus {
  service: 'api';
  status: 'ok';
}

@Injectable()
export class HealthService {
  getStatus(): HealthStatus {
    return {
      service: 'api',
      status: 'ok',
    };
  }
}
