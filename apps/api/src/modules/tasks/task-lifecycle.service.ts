import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Task, TaskEventType, TaskStatus } from '@execution/contracts';
import { TaskTransitionError, transitionTaskStatus } from '@execution/domain';

import { PrismaService } from '../../database/prisma.service';
import type { Prisma, Task as StoredTask } from '../../generated/prisma/client';
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

export interface TaskSchedulingInput {
  taskId: string;
  userId: string;
  dailyPlanId: string;
  planDate: string;
}

export interface TaskUnschedulingInput extends TaskSchedulingInput {
  returnToBacklog: boolean;
}

export type TaskCarryoverInput = TaskSchedulingInput;

@Injectable()
export class TaskLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async transition(input: TaskTransitionInput): Promise<Task> {
    return this.prisma.$transaction((transaction) =>
      this.transitionInTransaction(transaction, input),
    );
  }

  async transitionInTransaction(
    transaction: Prisma.TransactionClient,
    input: TaskTransitionInput,
  ): Promise<Task> {
    const current = await this.findOwnedTask(
      transaction,
      input.userId,
      input.taskId,
    );
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== current.version
    ) {
      throw new ConflictException({
        code: 'TASK_VERSION_CONFLICT',
        message: 'Task changed before the transition could be applied.',
      });
    }

    const transition = this.resolveTransition(current.status, input.to);

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
    if (update.count !== 1) this.throwVersionConflict();

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
  }

  async scheduleInTransaction(
    transaction: Prisma.TransactionClient,
    input: TaskSchedulingInput,
  ): Promise<Task> {
    const current = await this.findOwnedTask(
      transaction,
      input.userId,
      input.taskId,
    );
    const metadata = {
      dailyPlanId: input.dailyPlanId,
      planDate: input.planDate,
    };
    if (current.status === 'inbox' || current.status === 'backlog') {
      return this.transitionInTransaction(transaction, {
        taskId: input.taskId,
        userId: input.userId,
        to: 'planned',
        expectedVersion: current.version,
        metadata,
      });
    }
    if (
      ['planned', 'in_progress', 'waiting', 'blocked'].includes(current.status)
    ) {
      return this.appendEventOnly(transaction, current, 'scheduled', {
        fromStatus: current.status,
        toStatus: current.status,
        ...metadata,
      });
    }
    throw new ConflictException({
      code: 'TASK_NOT_SCHEDULABLE',
      message: 'The task cannot be scheduled from its current state.',
    });
  }

  async unscheduleInTransaction(
    transaction: Prisma.TransactionClient,
    input: TaskUnschedulingInput,
  ): Promise<Task> {
    const current = await this.findOwnedTask(
      transaction,
      input.userId,
      input.taskId,
    );
    const metadata = {
      dailyPlanId: input.dailyPlanId,
      planDate: input.planDate,
    };
    if (input.returnToBacklog && current.status === 'planned') {
      return this.transitionInTransaction(transaction, {
        taskId: input.taskId,
        userId: input.userId,
        to: 'backlog',
        expectedVersion: current.version,
        metadata,
      });
    }
    return this.appendEventOnly(transaction, current, 'unscheduled', {
      fromStatus: current.status,
      toStatus: current.status,
      ...metadata,
    });
  }

  async carryOverInTransaction(
    transaction: Prisma.TransactionClient,
    input: TaskCarryoverInput,
  ): Promise<{ task: Task; carryoverCount: number }> {
    const current = await this.findOwnedTask(
      transaction,
      input.userId,
      input.taskId,
    );
    this.resolveTransition(current.status, 'backlog');
    const nextCarryoverCount = current.carryoverCount + 1;
    const now = this.clock.now();
    const update = await transaction.task.updateMany({
      where: {
        id: current.id,
        userId: input.userId,
        status: current.status,
        version: current.version,
      },
      data: {
        status: 'backlog',
        carryoverCount: { increment: 1 },
        version: { increment: 1 },
      },
    });
    if (update.count !== 1) this.throwVersionConflict();
    await transaction.taskEvent.create({
      data: {
        userId: input.userId,
        taskId: current.id,
        taskVersion: current.version + 1,
        type: 'carried_over',
        metadata: {
          fromStatus: current.status,
          toStatus: 'backlog',
          dailyPlanId: input.dailyPlanId,
          sourcePlanDate: input.planDate,
          carryoverCount: nextCarryoverCount,
        },
        createdAt: now,
      },
    });
    return {
      task: toTaskContract(
        await transaction.task.findUniqueOrThrow({
          where: { id: current.id },
        }),
      ),
      carryoverCount: nextCarryoverCount,
    };
  }

  private async appendEventOnly(
    transaction: Prisma.TransactionClient,
    current: StoredTask,
    type: TaskEventType,
    metadata: Prisma.InputJsonObject,
  ): Promise<Task> {
    const update = await transaction.task.updateMany({
      where: {
        id: current.id,
        userId: current.userId,
        status: current.status,
        version: current.version,
      },
      data: { version: { increment: 1 } },
    });
    if (update.count !== 1) this.throwVersionConflict();
    await transaction.taskEvent.create({
      data: {
        userId: current.userId,
        taskId: current.id,
        taskVersion: current.version + 1,
        type,
        metadata,
        createdAt: this.clock.now(),
      },
    });
    return toTaskContract(
      await transaction.task.findUniqueOrThrow({ where: { id: current.id } }),
    );
  }

  private findOwnedTask(
    transaction: Prisma.TransactionClient,
    userId: string,
    taskId: string,
  ) {
    return transaction.task
      .findFirst({ where: { id: taskId, userId } })
      .then((task) => {
        if (!task) {
          throw new NotFoundException({
            code: 'TASK_NOT_FOUND',
            message: 'Task was not found.',
          });
        }
        return task;
      });
  }

  private resolveTransition(from: TaskStatus, to: TaskStatus) {
    try {
      return transitionTaskStatus(from, to);
    } catch (error) {
      if (error instanceof TaskTransitionError) {
        throw new ConflictException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private throwVersionConflict(): never {
    throw new ConflictException({
      code: 'TASK_VERSION_CONFLICT',
      message: 'Task changed before the transition could be applied.',
    });
  }
}
