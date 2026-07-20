import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Task, TaskStatus } from '@execution/contracts';
import { TaskTransitionError, transitionTaskStatus } from '@execution/domain';

import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { type Clock, CLOCK } from '../auth/clock';
import { toTaskContract } from './task-presenter';

type SafeMetadataValue = string | number | boolean | null;

export interface TaskTransitionInput {
  taskId: string;
  userId: string;
  to: TaskStatus;
  expectedVersion?: number;
  reason?: string;
  metadata?: Record<string, SafeMetadataValue>;
}

@Injectable()
export class TaskLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async transition(input: TaskTransitionInput): Promise<Task> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.task.findFirst({
        where: { id: input.taskId, userId: input.userId },
      });
      if (!current) {
        throw new NotFoundException({
          code: 'TASK_NOT_FOUND',
          message: 'Task was not found.',
        });
      }
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== current.version
      ) {
        throw new ConflictException({
          code: 'TASK_VERSION_CONFLICT',
          message: 'Task changed before the transition could be applied.',
        });
      }

      let transition: ReturnType<typeof transitionTaskStatus>;
      try {
        transition = transitionTaskStatus(current.status, input.to);
      } catch (error) {
        if (error instanceof TaskTransitionError) {
          throw new ConflictException({
            code: error.code,
            message: error.message,
          });
        }
        throw error;
      }

      const now = this.clock.now();
      const update = await transaction.task.updateMany({
        where: {
          id: current.id,
          userId: input.userId,
          status: current.status,
          version: current.version,
        },
        data: {
          status: input.to,
          completedAt: input.to === 'completed' ? now : null,
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) {
        throw new ConflictException({
          code: 'TASK_VERSION_CONFLICT',
          message: 'Task changed before the transition could be applied.',
        });
      }

      const metadata: Prisma.InputJsonObject = {
        fromStatus: transition.from,
        toStatus: transition.to,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.metadata ?? {}),
      };
      await transaction.taskEvent.create({
        data: {
          userId: input.userId,
          taskId: current.id,
          taskVersion: current.version + 1,
          type: transition.eventType,
          metadata,
          createdAt: now,
        },
      });

      const updated = await transaction.task.findUniqueOrThrow({
        where: { id: current.id },
      });
      return toTaskContract(updated);
    });
  }
}
