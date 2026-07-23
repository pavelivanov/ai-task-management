import 'dotenv/config';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';

import { requireSafeTestDatabaseUrl } from './test-database.js';

const origin = 'http://localhost:5173';
const taskFixtureCount = 2_000;
const requestSamples = 200;
const requestConcurrency = 20;
const sseWaves = 8;
const sseConnectionsPerWave = 10;
const suggestionCount = 20;

const pilotTargets = {
  requestP95Ms: 250,
  requestMaxMs: 1_000,
  sseCleanupMs: 2_000,
  sseHeapGrowthBytes: 32 * 1024 * 1024,
  databasePoolWaiting: 0,
  assistantQueueDrainMs: 30_000,
} as const;

type JsonRecord = Record<string, unknown>;

interface HttpResult {
  body: unknown;
  status: number;
}

interface LatencySummary {
  count: number;
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  withinPilotTarget: boolean;
}

interface QueryPlanSummary {
  indexes: string[];
  nodeTypes: string[];
  planningMs: number | null;
  executionMs: number | null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index] ?? 0;
}

function summarizeLatencies(samples: number[]): LatencySummary {
  const sorted = [...samples].sort((left, right) => left - right);
  const p95Ms = percentile(sorted, 0.95);
  const maxMs = sorted.at(-1) ?? 0;
  return {
    count: sorted.length,
    maxMs: round(maxMs),
    meanMs: round(
      sorted.reduce((total, sample) => total + sample, 0) / sorted.length,
    ),
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(p95Ms),
    withinPilotTarget:
      p95Ms <= pilotTargets.requestP95Ms && maxMs <= pilotTargets.requestMaxMs,
  };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<number> {
  const startedAt = performance.now();
  while (!(await predicate())) {
    if (performance.now() - startedAt >= timeoutMs) {
      throw new Error(`Condition was not met within ${String(timeoutMs)}ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return performance.now() - startedAt;
}

function collectPlanDetails(value: unknown, result: QueryPlanSummary): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPlanDetails(item, result);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as JsonRecord;
  if (typeof record['Node Type'] === 'string') {
    result.nodeTypes.push(record['Node Type']);
  }
  if (typeof record['Index Name'] === 'string') {
    result.indexes.push(record['Index Name']);
  }
  for (const nested of Object.values(record))
    collectPlanDetails(nested, result);
}

function summarizePlan(raw: unknown): QueryPlanSummary {
  const row = Array.isArray(raw)
    ? (raw[0] as JsonRecord | undefined)
    : undefined;
  const envelope = row?.['QUERY PLAN'];
  const document = Array.isArray(envelope)
    ? (envelope[0] as JsonRecord | undefined)
    : undefined;
  const result: QueryPlanSummary = {
    indexes: [],
    nodeTypes: [],
    planningMs:
      typeof document?.['Planning Time'] === 'number'
        ? round(document['Planning Time'])
        : null,
    executionMs:
      typeof document?.['Execution Time'] === 'number'
        ? round(document['Execution Time'])
        : null,
  };
  collectPlanDetails(document?.Plan, result);
  result.indexes = [...new Set(result.indexes)];
  result.nodeTypes = [...new Set(result.nodeTypes)];
  return result;
}

function assertSuccessful(result: HttpResult, context: string): void {
  assert.ok(
    result.status >= 200 && result.status < 300,
    `${context} failed with HTTP ${String(result.status)}: ${JSON.stringify(result.body)}`,
  );
}

async function main(): Promise<void> {
  const testDatabaseUrl = requireSafeTestDatabaseUrl();
  Object.assign(process.env, {
    API_RATE_LIMIT_PER_MINUTE: '10000',
    ASSISTANT_PROVIDER: 'fake',
    ASSISTANT_RATE_LIMIT_PER_MINUTE: '100',
    ASSISTANT_WORKER_INTERVAL_MS: '60000',
    AUTH_ALLOWED_CALLBACK_URLS: 'http://localhost:3000/auth/google/callback',
    AUTH_RATE_LIMIT_PER_MINUTE: '300',
    BEHAVIOR_SCHEDULER_INTERVAL_MS: '300000',
    DATABASE_URL: testDatabaseUrl.toString(),
    E2E_AUTH_ENABLED: 'true',
    GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
    GOOGLE_CLIENT_ID: 'pilot-resource-google-client-id',
    GOOGLE_CLIENT_SECRET: 'pilot-resource-google-client-secret',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
    NOTIFICATION_WORKER_INTERVAL_MS: '60000',
    PUSH_PROVIDER: 'fake',
    SSE_HEARTBEAT_SECONDS: '1',
    SSE_MAX_SUBSCRIBERS_PER_USER: '20',
    SSE_MAX_SUBSCRIBERS_TOTAL: '100',
    WEB_APP_URL: origin,
    WEB_ORIGINS: origin,
  });

  const [
    { NestFactory },
    { AppModule },
    { configureApplication },
    { PrismaService },
    { AssistantWorkerService },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/application.js'),
    import('../apps/api/dist/database/prisma.service.js'),
    import('../apps/api/dist/modules/assistant/assistant-worker.service.js'),
  ]);

  let primaryApp: INestApplication | null = null;
  let contenderApp: INestApplication | null = null;

  try {
    primaryApp = await NestFactory.create(AppModule, {
      abortOnError: false,
      logger: false,
    });
    configureApplication(primaryApp);
    await primaryApp.listen(0, '127.0.0.1');

    const address = primaryApp.getHttpServer().address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${String(address.port)}`;
    const prisma = primaryApp.get(PrismaService);
    const primaryWorker = primaryApp.get(AssistantWorkerService);

    async function http(
      path: string,
      options: {
        body?: unknown;
        cookie?: string;
        method?: string;
        signal?: AbortSignal;
      } = {},
    ): Promise<HttpResult> {
      const response = await fetch(`${baseUrl}${path}`, {
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        headers: {
          ...(options.body === undefined
            ? {}
            : { 'Content-Type': 'application/json' }),
          ...(options.cookie ? { Cookie: options.cookie } : {}),
          Origin: origin,
        },
        method: options.method ?? 'GET',
        signal: options.signal,
      });
      const text = await response.text();
      return {
        body: text ? (JSON.parse(text) as unknown) : null,
        status: response.status,
      };
    }

    async function login(label: string): Promise<{
      cookie: string;
      userId: string;
    }> {
      const response = await fetch(`${baseUrl}/auth/e2e/login`, {
        body: JSON.stringify({
          displayName: `Pilot ${label}`,
          email: `pilot-${label}@example.test`,
        }),
        headers: { 'Content-Type': 'application/json', Origin: origin },
        method: 'POST',
      });
      const body = (await response.json()) as JsonRecord;
      assert.equal(response.status, 201);
      assert.equal(typeof body.id, 'string');
      const setCookie = response.headers.get('set-cookie');
      assert.ok(setCookie, 'E2E login did not return a session cookie.');
      return {
        cookie: setCookie.split(';', 1)[0] as string,
        userId: body.id as string,
      };
    }

    async function measureRequests(
      action: () => Promise<HttpResult>,
    ): Promise<LatencySummary> {
      for (let index = 0; index < 10; index += 1) {
        assertSuccessful(await action(), 'warm-up request');
      }
      const samples: number[] = [];
      for (
        let offset = 0;
        offset < requestSamples;
        offset += requestConcurrency
      ) {
        const batchSize = Math.min(requestConcurrency, requestSamples - offset);
        const batch = await Promise.all(
          Array.from({ length: batchSize }, async () => {
            const startedAt = performance.now();
            const result = await action();
            return { durationMs: performance.now() - startedAt, result };
          }),
        );
        for (const item of batch) {
          assertSuccessful(item.result, 'measured request');
          samples.push(item.durationMs);
        }
      }
      return summarizeLatencies(samples);
    }

    const listUser = await login('task-list');
    await prisma.task.createMany({
      data: Array.from({ length: taskFixtureCount }, (_, index) => ({
        category: 'work' as const,
        priority: 'normal' as const,
        status: 'backlog' as const,
        title: `Pilot load task ${String(index).padStart(4, '0')}`,
        userId: listUser.userId,
      })),
    });

    const initialPage = await http('/tasks?status=backlog&limit=50', {
      cookie: listUser.cookie,
    });
    assertSuccessful(initialPage, 'task page');
    const initialPageBody = initialPage.body as JsonRecord;
    assert.equal((initialPageBody.items as unknown[]).length, 50);
    assert.equal(typeof initialPageBody.nextCursor, 'string');

    const taskListLatency = await measureRequests(() =>
      http('/tasks?status=backlog&limit=50', { cookie: listUser.cookie }),
    );
    const currentFocusLatency = await measureRequests(() =>
      http('/focus/current', { cookie: listUser.cookie }),
    );

    const focusUser = await login('focus-race');
    const focusTasks = await prisma.task.createManyAndReturn({
      data: Array.from({ length: requestConcurrency }, (_, index) => ({
        category: 'work' as const,
        priority: 'normal' as const,
        status: 'backlog' as const,
        title: `Concurrent focus candidate ${String(index)}`,
        userId: focusUser.userId,
      })),
      select: { id: true },
    });
    const focusStartedAt = performance.now();
    const focusAttempts = await Promise.all(
      focusTasks.map(({ id }) =>
        http('/focus/start', {
          body: { taskId: id },
          cookie: focusUser.cookie,
          method: 'POST',
        }),
      ),
    );
    const focusRaceMs = performance.now() - focusStartedAt;
    const focusSuccesses = focusAttempts.filter(
      ({ status }) => status >= 200 && status < 300,
    );
    const focusConflicts = focusAttempts.filter(({ status }) => status === 409);
    assert.equal(focusSuccesses.length, 1);
    assert.equal(focusConflicts.length, requestConcurrency - 1);
    assert.equal(
      await prisma.focusSession.count({
        where: {
          status: { in: ['active', 'paused', 'waiting', 'blocked'] },
          userId: focusUser.userId,
        },
      }),
      1,
    );

    const closeUser = await login('day-close');
    const plan = await http('/daily-plans/today', {
      body: {},
      cookie: closeUser.cookie,
      method: 'POST',
    });
    assertSuccessful(plan, 'daily plan creation');
    const planVersion = (plan.body as JsonRecord).version;
    assert.equal(typeof planVersion, 'number');
    const closeStartedAt = performance.now();
    const closeAttempts = await Promise.all(
      Array.from({ length: requestConcurrency }, () =>
        http('/daily-plans/today/close', {
          body: { expectedPlanVersion: planVersion },
          cookie: closeUser.cookie,
          method: 'POST',
        }),
      ),
    );
    const dayCloseRaceMs = performance.now() - closeStartedAt;
    const closeSuccesses = closeAttempts.filter(
      ({ status }) => status >= 200 && status < 300,
    );
    const closeConflicts = closeAttempts.filter(({ status, body }) => {
      return (
        status === 409 &&
        (body as JsonRecord).code === 'DAILY_PLAN_VERSION_CONFLICT'
      );
    });
    assert.ok(closeSuccesses.length >= 1);
    assert.equal(
      closeSuccesses.length + closeConflicts.length,
      requestConcurrency,
    );
    const idempotentClose = await http('/daily-plans/today/close', {
      body: {},
      cookie: closeUser.cookie,
      method: 'POST',
    });
    assertSuccessful(idempotentClose, 'idempotent day close retry');
    assert.equal((idempotentClose.body as JsonRecord).status, 'closed');
    for (const result of closeSuccesses) {
      assert.equal((result.body as JsonRecord).status, 'closed');
    }
    assert.equal(
      await prisma.dailyPlan.count({ where: { userId: closeUser.userId } }),
      1,
    );
    assert.equal(
      await prisma.dailyReview.count({ where: { userId: closeUser.userId } }),
      1,
    );

    const sseUser = await login('sse');
    const sseHeapBefore = process.memoryUsage().heapUsed;
    const cleanupSamples: number[] = [];
    let peakSseConnections = 0;
    for (let wave = 0; wave < sseWaves; wave += 1) {
      const streams = await Promise.all(
        Array.from({ length: sseConnectionsPerWave }, async () => {
          const controller = new AbortController();
          const response = await fetch(`${baseUrl}/events`, {
            headers: { Cookie: sseUser.cookie, Origin: origin },
            signal: controller.signal,
          });
          assert.equal(response.status, 200);
          const reader = response.body?.getReader();
          assert.ok(reader);
          await reader.read();
          return { controller, reader };
        }),
      );
      const metrics = await http('/health/metrics');
      assertSuccessful(metrics, 'operational metrics');
      const activeConnections = Number(
        ((metrics.body as JsonRecord).sse as JsonRecord).activeConnections,
      );
      peakSseConnections = Math.max(peakSseConnections, activeConnections);
      assert.equal(activeConnections, sseConnectionsPerWave);

      const cleanupStartedAt = performance.now();
      for (const stream of streams) stream.controller.abort();
      await Promise.allSettled(streams.map(({ reader }) => reader.cancel()));
      const cleanupMs = await waitFor(async () => {
        const current = await http('/health/metrics');
        return (
          Number(
            ((current.body as JsonRecord).sse as JsonRecord).activeConnections,
          ) === 0
        );
      }, pilotTargets.sseCleanupMs);
      cleanupSamples.push(cleanupMs);
    }
    const sseHeapGrowthBytes = process.memoryUsage().heapUsed - sseHeapBefore;
    const sseRetainedHeapGrowthBytes = Math.max(0, sseHeapGrowthBytes);
    assert.ok(
      Math.max(...cleanupSamples) <= pilotTargets.sseCleanupMs,
      'SSE cleanup exceeded the pilot target.',
    );
    assert.ok(
      sseRetainedHeapGrowthBytes <= pilotTargets.sseHeapGrowthBytes,
      `SSE heap growth exceeded ${String(pilotTargets.sseHeapGrowthBytes)} bytes.`,
    );

    const assistantUser = await login('assistant-queue');
    const suggestionIds: string[] = [];
    for (let index = 0; index < suggestionCount; index += 1) {
      const result = await http('/assistant/suggestions', {
        body: {
          idempotencyKey: `pilot-daily-plan-${String(index).padStart(3, '0')}`,
          type: 'daily_plan',
        },
        cookie: assistantUser.cookie,
        method: 'POST',
      });
      assert.equal(result.status, 202);
      suggestionIds.push((result.body as JsonRecord).id as string);
    }

    contenderApp = await NestFactory.create(AppModule, {
      abortOnError: false,
      logger: false,
    });
    configureApplication(contenderApp);
    await contenderApp.init();
    const contenderWorker = contenderApp.get(AssistantWorkerService);
    const queueStartedAt = performance.now();
    let emptyRounds = 0;
    while (emptyRounds < 2) {
      assert.ok(
        performance.now() - queueStartedAt < pilotTargets.assistantQueueDrainMs,
        'Assistant queue did not drain within the pilot target.',
      );
      const claims = await Promise.all([
        primaryWorker.runOnce(),
        contenderWorker.runOnce(),
      ]);
      emptyRounds = claims.some(Boolean) ? 0 : emptyRounds + 1;
    }
    const queueDrainMs = performance.now() - queueStartedAt;
    const suggestions = await prisma.aiSuggestion.findMany({
      where: { id: { in: suggestionIds } },
      select: {
        id: true,
        leaseOwner: true,
        retryCount: true,
        status: true,
      },
    });
    assert.equal(suggestions.length, suggestionCount);
    assert.ok(
      suggestions.every(
        (suggestion) =>
          suggestion.status === 'completed' &&
          suggestion.leaseOwner === null &&
          suggestion.retryCount === 0,
      ),
      'Every queued suggestion must complete exactly once without a retained lease.',
    );

    const dedupeKey = 'pilot-notification-dedupe';
    const notificationAttempts = await Promise.allSettled(
      Array.from({ length: requestConcurrency }, () =>
        prisma.notification.create({
          data: {
            body: 'Synthetic pilot notification',
            dedupeKey,
            deepLink: '/today',
            scheduledAt: new Date(),
            title: 'Pilot notification',
            type: 'morning_plan',
            userId: assistantUser.userId,
          },
        }),
      ),
    );
    assert.equal(
      notificationAttempts.filter(({ status }) => status === 'fulfilled')
        .length,
      1,
    );
    assert.equal(
      await prisma.notification.count({
        where: { dedupeKey, userId: assistantUser.userId },
      }),
      1,
    );

    const queryPlans = {
      assistantClaim: summarizePlan(
        await prisma.$queryRawUnsafe(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
           SELECT id
           FROM ai_suggestions
           WHERE "expiresAt" > now()
             AND (
               (status = 'queued' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now()))
               OR (status = 'running' AND "leaseExpiresAt" <= now())
             )
           ORDER BY "createdAt" ASC, id ASC
           LIMIT 1`,
        ),
      ),
      currentFocus: summarizePlan(
        await prisma.$queryRawUnsafe(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
           SELECT id
           FROM focus_sessions
           WHERE "userId" = $1::uuid
             AND status IN ('active', 'paused', 'waiting', 'blocked')
           ORDER BY "startedAt" DESC, id DESC
           LIMIT 1`,
          focusUser.userId,
        ),
      ),
      notifications: summarizePlan(
        await prisma.$queryRawUnsafe(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
           SELECT id
           FROM notifications
           WHERE "userId" = $1::uuid
           ORDER BY "createdAt" DESC, id DESC
           LIMIT 50`,
          assistantUser.userId,
        ),
      ),
      taskList: summarizePlan(
        await prisma.$queryRawUnsafe(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
           SELECT id
           FROM tasks
           WHERE "userId" = $1::uuid AND status = 'backlog'
           ORDER BY "createdAt" DESC, id DESC
           LIMIT 50`,
          listUser.userId,
        ),
      ),
    };
    const expectedIndexes = [
      'ai_suggestions_status_leaseExpiresAt_createdAt_id_idx',
      'focus_sessions_userId_status_startedAt_id_idx',
      'notifications_userId_readAt_createdAt_id_idx',
      'notifications_userId_dedupeKey_key',
      'one_open_focus_session_per_user',
      'tasks_userId_status_createdAt_id_idx',
    ];
    const indexRows = await prisma.$queryRawUnsafe<
      Array<{ indexname: string }>
    >(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = current_schema()
       ORDER BY indexname`,
    );
    const availableIndexes = new Set(
      indexRows.map(({ indexname }) => indexname),
    );
    for (const indexName of expectedIndexes) {
      assert.ok(availableIndexes.has(indexName), `Missing index ${indexName}.`);
    }

    const metrics = await http('/health/metrics');
    assertSuccessful(metrics, 'final operational metrics');
    const databasePool = ((metrics.body as JsonRecord).database as JsonRecord)
      .pool as JsonRecord;
    assert.equal(
      Number(databasePool.waiting),
      pilotTargets.databasePoolWaiting,
    );

    const report = {
      decision: {
        redis: 'not_needed',
        rationale:
          'The single-process private-pilot topology met the bounded request, cleanup, dedupe, and database-backed claim invariants.',
        revisitWhen: [
          'sustained request p95 exceeds 250 ms or request max exceeds 1 s',
          'database pool waiting is non-zero during representative load',
          'assistant queue age or drain time exceeds 30 s',
          'more than one API replica is required for availability or throughput',
          'SSE invalidations must cross process or host boundaries',
        ],
      },
      environment: {
        database: 'local PostgreSQL test database',
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
      },
      fixtures: {
        concurrentMutations: requestConcurrency,
        requestConcurrency,
        requestSamples,
        sseConnectionsPerWave,
        sseWaves,
        suggestionCount,
        tasks: taskFixtureCount,
      },
      invariants: {
        assistantSuggestionsCompleted: suggestions.length,
        concurrentDayCloseConflicts: closeConflicts.length,
        concurrentDayCloseSuccesses: closeSuccesses.length,
        concurrentFocusConflicts: focusConflicts.length,
        concurrentFocusSuccesses: focusSuccesses.length,
        notificationsWithDedupeKey: 1,
        openFocusSessions: 1,
      },
      latencyMs: {
        concurrentDayClose: round(dayCloseRaceMs),
        concurrentFocusStart: round(focusRaceMs),
        currentFocus: currentFocusLatency,
        taskList: taskListLatency,
      },
      queryPlans,
      resources: {
        assistantQueueDrainMs: round(queueDrainMs),
        databasePool,
        sse: {
          cleanupMaxMs: round(Math.max(...cleanupSamples)),
          heapDeltaBytes: sseHeapGrowthBytes,
          peakConnections: peakSseConnections,
          retainedHeapGrowthBytes: sseRetainedHeapGrowthBytes,
        },
      },
      targets: pilotTargets,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await contenderApp?.close();
    await primaryApp?.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
