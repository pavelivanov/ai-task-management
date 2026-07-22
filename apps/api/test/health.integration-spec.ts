import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { StructuredLogger } from '../src/common/observability/structured-logger.service';
import { PrismaService } from '../src/database/prisma.service';

describe('GET /health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a stable machine-readable response', async () => {
    await request(app.getHttpServer()).get('/health').expect(200).expect({
      service: 'api',
      status: 'ok',
    });
  });

  it('propagates a safe request ID and replaces an invalid one', async () => {
    const requestId = '7f7472f0-f7d4-4bb0-9a69-758fdd73f91f';
    await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', requestId)
      .expect('x-request-id', requestId)
      .expect(200);

    const response = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', 'not safe because spaces')
      .expect(200);
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/,
    );
  });

  it('reports readiness from the database and applied migration state', async () => {
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({
        service: 'api',
        status: 'ready',
        checks: { database: 'ok', migrations: 'ok' },
      });
  });

  it('returns a sanitized failure when the readiness probe fails', async () => {
    const prisma = app.get(PrismaService);
    const probe = jest
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('PRIVATE_DATABASE_ERROR_CANARY'));

    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503)
      .expect({
        code: 'SERVICE_NOT_READY',
        message: 'The service is not ready to receive traffic.',
        checks: { database: 'failed', migrations: 'failed' },
      });
    probe.mockRestore();
  });

  it('rejects traffic when the required migration is absent', async () => {
    const prisma = app.get(PrismaService);
    const probe = jest.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([
      {
        databaseReady: true,
        migrationFailures: 0,
        requiredMigrationApplied: false,
      },
    ]);

    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503)
      .expect({
        code: 'SERVICE_NOT_READY',
        message: 'The service is not ready to receive traffic.',
        checks: { database: 'ok', migrations: 'failed' },
      });
    probe.mockRestore();
  });

  it('exposes bounded operational metrics without request content', async () => {
    const logger = app.get(StructuredLogger);
    const log = jest.spyOn(logger, 'info');
    await request(app.getHttpServer())
      .post('/inbox/capture')
      .set('origin', 'http://localhost:5173')
      .send({ title: 'PRIVATE_TASK_BODY_CANARY', category: 'work' })
      .expect(401);

    expect(JSON.stringify(log.mock.calls)).not.toContain(
      'PRIVATE_TASK_BODY_CANARY',
    );
    log.mockRestore();

    const response = await request(app.getHttpServer())
      .get('/health/metrics')
      .expect(200);
    expect(response.body).toMatchObject({
      requests: expect.any(Array),
      database: {
        probe: expect.any(Object),
        pool: {
          total: expect.any(Number),
          idle: expect.any(Number),
          waiting: expect.any(Number),
        },
      },
      workers: { assistant: expect.any(Object) },
      assistant: expect.any(Array),
      sse: { activeConnections: 0 },
      push: { outcomes: expect.any(Object) },
    });
    expect(JSON.stringify(response.body)).not.toContain(
      'PRIVATE_TASK_BODY_CANARY',
    );
  });
});
