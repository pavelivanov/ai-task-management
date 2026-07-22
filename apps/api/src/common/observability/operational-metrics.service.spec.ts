import { OperationalMetrics } from './operational-metrics.service';

describe('OperationalMetrics', () => {
  it('records bounded request, provider, worker, SSE, push, and database metrics', () => {
    const metrics = new OperationalMetrics();

    metrics.recordRequest({
      method: 'GET',
      route: '/tasks/:id',
      statusCode: 200,
      durationMs: 42,
    });
    metrics.recordAssistant({
      promptVersion: 'task-extraction-v1',
      provider: 'fake',
      outcome: 'success',
      durationMs: 12,
      inputTokens: 10,
      outputTokens: 4,
    });
    metrics.recordAssistantWorkerClaim(2_400);
    metrics.recordAssistantWorkerFailure();
    metrics.setSseConnections(2);
    metrics.recordPushOutcome('delivered');
    metrics.recordDatabaseProbe(true, 3.7);

    const snapshot = metrics.snapshot({ total: 3, idle: 2, waiting: 0 });
    expect(snapshot.requests).toEqual([
      expect.objectContaining({
        method: 'GET',
        route: '/tasks/:id',
        statusClass: '2xx',
        count: 1,
      }),
    ]);
    expect(snapshot.assistant).toEqual([
      expect.objectContaining({
        promptVersion: 'task-extraction-v1',
        provider: 'fake',
        outcome: 'success',
        inputTokens: 10,
      }),
    ]);
    expect(snapshot.workers.assistant).toMatchObject({
      claims: 1,
      failures: 1,
      lastQueueAgeSeconds: 2,
    });
    expect(snapshot.sse.activeConnections).toBe(2);
    expect(snapshot.push.outcomes.delivered).toBe(1);
    expect(snapshot.database).toMatchObject({
      probe: { healthy: true, latencyMs: 4 },
      pool: { total: 3, idle: 2, waiting: 0 },
    });
  });

  it('collapses excessive and untrusted labels into bounded overflow series', () => {
    const metrics = new OperationalMetrics();

    for (let index = 0; index < 250; index += 1) {
      metrics.recordRequest({
        method: 'GET',
        route: `/untrusted route ${index}`,
        statusCode: 200,
        durationMs: 1,
      });
    }

    const snapshot = metrics.snapshot({ total: 0, idle: 0, waiting: 0 });
    expect(snapshot.requests).toHaveLength(1);
    expect(snapshot.requests[0]).toMatchObject({
      route: 'unmatched',
      count: 250,
    });
  });
});
