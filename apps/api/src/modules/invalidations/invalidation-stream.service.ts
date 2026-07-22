import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleDestroy,
} from '@nestjs/common';
import type {
  InvalidationEvent,
  InvalidationEventType,
} from '@execution/contracts';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

import { AppConfig } from '../../config/app-config.service';
import { OperationalMetrics } from '../../common/observability/operational-metrics.service';
import { type Clock, CLOCK } from '../auth/clock';

interface Subscriber {
  response: Response;
  cleanup: () => void;
  heartbeat: NodeJS.Timeout;
}

export interface PublishInvalidationInput {
  type: InvalidationEventType;
  resourceId: string;
  resourceVersion: number;
}

@Injectable()
export class InvalidationStreamService implements OnModuleDestroy {
  private readonly subscribers = new Map<string, Map<string, Subscriber>>();
  private subscriberCount = 0;

  constructor(
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly metrics: OperationalMetrics,
  ) {}

  open(userId: string, request: Request, response: Response): void {
    const userSubscribers = this.subscribers.get(userId);
    if (
      (userSubscribers?.size ?? 0) >= this.config.sseMaxSubscribersPerUser ||
      this.subscriberCount >= this.config.sseMaxSubscribersTotal
    ) {
      throw new HttpException(
        {
          code: 'EVENT_STREAM_LIMIT',
          message: 'The event stream subscriber limit was reached.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    response.status(HttpStatus.OK);
    response.set({
      'Cache-Control':
        'private, no-cache, no-store, must-revalidate, max-age=0, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.write(': connected\n\n');

    const id = randomUUID();
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      const current = this.subscribers.get(userId);
      const subscriber = current?.get(id);
      if (subscriber) {
        clearInterval(subscriber.heartbeat);
        current?.delete(id);
        this.subscriberCount -= 1;
        this.metrics.setSseConnections(this.subscriberCount);
      }
      if (current?.size === 0) this.subscribers.delete(userId);
    };
    const heartbeat = setInterval(() => {
      if (response.writableEnded || response.destroyed) {
        cleanup();
        return;
      }
      response.write(': heartbeat\n\n');
    }, this.config.sseHeartbeatSeconds * 1_000);
    heartbeat.unref();

    const subscriber: Subscriber = { response, cleanup, heartbeat };
    const target = userSubscribers ?? new Map<string, Subscriber>();
    target.set(id, subscriber);
    this.subscribers.set(userId, target);
    this.subscriberCount += 1;
    this.metrics.setSseConnections(this.subscriberCount);

    request.once('aborted', cleanup);
    response.once('close', cleanup);
    response.once('error', cleanup);
  }

  publish(userId: string, input: PublishInvalidationInput): InvalidationEvent {
    const event: InvalidationEvent = {
      id: randomUUID(),
      type: input.type,
      occurredAt: this.clock.now().toISOString(),
      resourceId: input.resourceId,
      resourceVersion: input.resourceVersion,
    };
    const payload = this.format(event);
    for (const subscriber of this.subscribers.get(userId)?.values() ?? []) {
      if (subscriber.response.writableEnded || subscriber.response.destroyed) {
        subscriber.cleanup();
      } else {
        const accepted = subscriber.response.write(payload);
        if (!accepted) {
          subscriber.cleanup();
          subscriber.response.end();
        }
      }
    }
    return event;
  }

  activeSubscriberCount(userId?: string): number {
    return userId === undefined
      ? this.subscriberCount
      : (this.subscribers.get(userId)?.size ?? 0);
  }

  closeUser(userId: string): void {
    for (const subscriber of this.subscribers.get(userId)?.values() ?? []) {
      subscriber.cleanup();
      if (!subscriber.response.writableEnded) subscriber.response.end();
    }
  }

  onModuleDestroy(): void {
    for (const subscribers of this.subscribers.values()) {
      for (const subscriber of subscribers.values()) {
        subscriber.cleanup();
        if (!subscriber.response.writableEnded) subscriber.response.end();
      }
    }
  }

  private format(event: InvalidationEvent): string {
    return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  }
}
