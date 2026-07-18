import { Test } from '@nestjs/testing';

import { HealthService } from './health.service';

describe('HealthService', () => {
  it('returns the stable API health contract', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [HealthService],
    }).compile();

    expect(moduleRef.get(HealthService).getStatus()).toEqual({
      service: 'api',
      status: 'ok',
    });
  });
});
