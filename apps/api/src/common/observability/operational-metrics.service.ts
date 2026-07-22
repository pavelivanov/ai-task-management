import { Injectable } from '@nestjs/common';

const latencyBoundsMs = [25, 100, 250, 1_000, 5_000] as const;
const maximumRequestSeries = 200;
const maximumAssistantSeries = 50;

interface Histogram {
  count: number;
  sumMs: number;
  buckets: Record<string, number>;
}

interface RequestMetric extends Histogram {
  method: string;
  route: string;
  statusClass: string;
}

interface AssistantMetric extends Histogram {
  promptVersion: string;
  provider: string;
  outcome: string;
  inputTokens: number;
  outputTokens: number;
}

export interface DatabasePoolMetrics {
  total: number;
  idle: number;
  waiting: number;
}

function newHistogram(): Histogram {
  return {
    count: 0,
    sumMs: 0,
    buckets: Object.fromEntries([
      ...latencyBoundsMs.map((bound) => [`le_${bound}`, 0]),
      ['le_inf', 0],
    ]),
  };
}

function observe(histogram: Histogram, durationMs: number): void {
  const safeDuration = Math.max(0, Math.round(durationMs));
  histogram.count += 1;
  histogram.sumMs += safeDuration;
  for (const bound of latencyBoundsMs) {
    if (safeDuration <= bound) {
      const key = `le_${bound}`;
      histogram.buckets[key] = (histogram.buckets[key] ?? 0) + 1;
    }
  }
  histogram.buckets.le_inf = (histogram.buckets.le_inf ?? 0) + 1;
}

function boundedLabel(value: string, fallback: string): string {
  return /^[a-zA-Z0-9._:/-]{1,120}$/.test(value) ? value : fallback;
}

@Injectable()
export class OperationalMetrics {
  private readonly startedAt = Date.now();
  private readonly requests = new Map<string, RequestMetric>();
  private readonly assistant = new Map<string, AssistantMetric>();
  private readonly pushOutcomes: Record<string, number> = {
    delivered: 0,
    disabled: 0,
    failed: 0,
    permanent: 0,
    revoked: 0,
    skipped: 0,
    transient: 0,
  };
  private readonly assistantWorker = {
    claims: 0,
    failures: 0,
    lastQueueAgeSeconds: 0,
    maximumQueueAgeSeconds: 0,
  };
  private sseConnections = 0;
  private databaseProbe = {
    healthy: false,
    latencyMs: 0,
    checkedAt: null as string | null,
  };

  recordRequest(input: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
  }): void {
    const method = boundedLabel(input.method.toUpperCase(), 'OTHER');
    const route = boundedLabel(input.route, 'unmatched');
    const statusClass = `${Math.floor(input.statusCode / 100)}xx`;
    const desiredKey = `${method}:${route}:${statusClass}`;
    const key =
      this.requests.has(desiredKey) || this.requests.size < maximumRequestSeries
        ? desiredKey
        : 'OTHER:overflow:other';
    let metric = this.requests.get(key);
    if (!metric) {
      metric = {
        ...newHistogram(),
        method: key === desiredKey ? method : 'OTHER',
        route: key === desiredKey ? route : 'overflow',
        statusClass: key === desiredKey ? statusClass : 'other',
      };
      this.requests.set(key, metric);
    }
    observe(metric, input.durationMs);
  }

  recordAssistant(input: {
    promptVersion: string;
    provider: string;
    outcome: string;
    durationMs: number;
    inputTokens?: number | null;
    outputTokens?: number | null;
  }): void {
    const promptVersion = boundedLabel(input.promptVersion, 'unknown');
    const provider = boundedLabel(input.provider, 'unknown');
    const outcome = boundedLabel(input.outcome, 'unknown');
    const desiredKey = `${promptVersion}:${provider}:${outcome}`;
    const key =
      this.assistant.has(desiredKey) ||
      this.assistant.size < maximumAssistantSeries
        ? desiredKey
        : 'overflow:overflow:overflow';
    let metric = this.assistant.get(key);
    if (!metric) {
      const overflow = key !== desiredKey;
      metric = {
        ...newHistogram(),
        promptVersion: overflow ? 'overflow' : promptVersion,
        provider: overflow ? 'overflow' : provider,
        outcome: overflow ? 'overflow' : outcome,
        inputTokens: 0,
        outputTokens: 0,
      };
      this.assistant.set(key, metric);
    }
    observe(metric, input.durationMs);
    metric.inputTokens += Math.max(0, input.inputTokens ?? 0);
    metric.outputTokens += Math.max(0, input.outputTokens ?? 0);
  }

  recordAssistantWorkerClaim(queueAgeMs: number): void {
    const ageSeconds = Math.max(0, Math.round(queueAgeMs / 1_000));
    this.assistantWorker.claims += 1;
    this.assistantWorker.lastQueueAgeSeconds = ageSeconds;
    this.assistantWorker.maximumQueueAgeSeconds = Math.max(
      this.assistantWorker.maximumQueueAgeSeconds,
      ageSeconds,
    );
  }

  recordAssistantWorkerFailure(): void {
    this.assistantWorker.failures += 1;
  }

  recordPushOutcome(
    outcome:
      | 'delivered'
      | 'disabled'
      | 'failed'
      | 'permanent'
      | 'revoked'
      | 'skipped'
      | 'transient',
  ): void {
    this.pushOutcomes[outcome] = (this.pushOutcomes[outcome] ?? 0) + 1;
  }

  setSseConnections(value: number): void {
    this.sseConnections = Math.max(0, value);
  }

  recordDatabaseProbe(healthy: boolean, latencyMs: number): void {
    this.databaseProbe = {
      healthy,
      latencyMs: Math.max(0, Math.round(latencyMs)),
      checkedAt: new Date().toISOString(),
    };
  }

  snapshot(databasePool: DatabasePoolMetrics) {
    return {
      generatedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1_000),
      requests: [...this.requests.values()].sort((left, right) =>
        `${left.method}:${left.route}:${left.statusClass}`.localeCompare(
          `${right.method}:${right.route}:${right.statusClass}`,
        ),
      ),
      database: {
        probe: { ...this.databaseProbe },
        pool: databasePool,
      },
      workers: { assistant: { ...this.assistantWorker } },
      assistant: [...this.assistant.values()].sort((left, right) =>
        `${left.promptVersion}:${left.provider}:${left.outcome}`.localeCompare(
          `${right.promptVersion}:${right.provider}:${right.outcome}`,
        ),
      ),
      sse: { activeConnections: this.sseConnections },
      push: { outcomes: { ...this.pushOutcomes } },
    };
  }
}
