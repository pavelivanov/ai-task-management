import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateTask,
  ListInboxQuery,
  ListTasksQuery,
  Task,
  TaskEventType,
  TaskHistoryPage,
  TaskHistoryQuery,
  TaskPage,
  TaskStatus,
  UpdateTask,
} from '@execution/contracts';
import {
  validateTaskDescription,
  validateTaskDueAt,
  validateTaskEstimate,
  validateTaskTitle,
} from '@execution/domain';

import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { type Clock, CLOCK } from '../auth/clock';
import { toTaskContract, toTaskEventContract } from './task-presenter';

type Transaction = Prisma.TransactionClient;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  create(
    userId: string,
    input: CreateTask,
    status: TaskStatus = 'backlog',
  ): Promise<Task> {
    return this.prisma.$transaction((transaction) =>
      this.createInTransaction(transaction, userId, input, status),
    );
  }

  async createInTransaction(
    transaction: Transaction,
    userId: string,
    input: CreateTask,
    status: TaskStatus = 'backlog',
    creationMetadata: Prisma.InputJsonObject = {},
  ): Promise<Task> {
    const normalized = this.normalizeCreateInput(input);
    await this.validateAssociations(
      transaction,
      userId,
      normalized.projectId,
      normalized.parentTaskId,
    );

    const now = this.clock.now();
    const task = await transaction.task.create({
      data: {
        userId,
        title: normalized.title,
        description: normalized.description,
        category: input.category,
        status,
        priority: input.priority,
        estimateMinutes: normalized.estimateMinutes,
        dueAt: normalized.dueAt,
        projectId: normalized.projectId,
        parentTaskId: normalized.parentTaskId,
        createdAt: now,
        updatedAt: now,
      },
    });
    await transaction.taskEvent.create({
      data: {
        userId,
        taskId: task.id,
        taskVersion: task.version,
        type: 'created',
        metadata: { status, ...creationMetadata },
        createdAt: now,
      },
    });
    return toTaskContract(task);
  }

  async appendAssistantAcceptanceInTransaction(
    transaction: Transaction,
    userId: string,
    taskId: string,
    suggestionId: string,
    metadata: Prisma.InputJsonObject = {},
  ): Promise<Task> {
    const current = await transaction.task.findFirst({
      where: { id: taskId, userId },
    });
    if (!current) this.throwNotFound();
    const update = await transaction.task.updateMany({
      where: { id: taskId, userId, version: current.version },
      data: { version: { increment: 1 } },
    });
    if (update.count !== 1) this.throwVersionConflict();
    await transaction.taskEvent.create({
      data: {
        userId,
        taskId,
        taskVersion: current.version + 1,
        type: 'ai_suggestion_accepted',
        metadata: { suggestionId, ...metadata },
        createdAt: this.clock.now(),
      },
    });
    return toTaskContract(
      await transaction.task.findUniqueOrThrow({ where: { id: taskId } }),
    );
  }

  async setBlockReasonFromSuggestionInTransaction(
    transaction: Transaction,
    input: {
      userId: string;
      taskId: string;
      expectedVersion: number;
      suggestionId: string;
      blockReason:
        | 'unclear_next_step'
        | 'too_large'
        | 'missing_information'
        | 'fear_of_error'
        | 'low_value'
        | 'boring'
        | 'external_dependency'
        | 'other';
      details: string;
    },
  ): Promise<Task> {
    const current = await transaction.task.findFirst({
      where: { id: input.taskId, userId: input.userId },
    });
    if (!current) this.throwNotFound();
    if (current.version !== input.expectedVersion) this.throwVersionConflict();
    const update = await transaction.task.updateMany({
      where: {
        id: input.taskId,
        userId: input.userId,
        version: input.expectedVersion,
      },
      data: {
        blockReason: input.blockReason,
        blockReasonDetails: input.details,
        version: { increment: 1 },
      },
    });
    if (update.count !== 1) this.throwVersionConflict();
    await transaction.taskEvent.create({
      data: {
        userId: input.userId,
        taskId: input.taskId,
        taskVersion: input.expectedVersion + 1,
        type: 'ai_suggestion_accepted',
        metadata: {
          suggestionId: input.suggestionId,
          changedFields: ['blockReason', 'blockReasonDetails'],
        },
        createdAt: this.clock.now(),
      },
    });
    return toTaskContract(
      await transaction.task.findUniqueOrThrow({
        where: { id: input.taskId },
      }),
    );
  }

  async get(userId: string, taskId: string): Promise<Task> {
    const task = await this.findOwnedTask(userId, taskId);
    return toTaskContract(task);
  }

  async list(userId: string, query: ListTasksQuery): Promise<TaskPage> {
    const where: Prisma.TaskWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
    };
    if (query.cursor) {
      await this.assertTaskCursor(where, query.cursor);
    }
    const tasks = await this.prisma.task.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = tasks.length > query.limit;
    const items = hasMore ? tasks.slice(0, query.limit) : tasks;
    return {
      items: items.map(toTaskContract),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async listInbox(userId: string, query: ListInboxQuery): Promise<TaskPage> {
    const where: Prisma.TaskWhereInput = { userId, status: 'inbox' };
    if (query.cursor) {
      await this.assertTaskCursor(where, query.cursor);
    }
    const tasks = await this.prisma.task.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = tasks.length > query.limit;
    const items = hasMore ? tasks.slice(0, query.limit) : tasks;
    return {
      items: items.map(toTaskContract),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  update(userId: string, taskId: string, patch: UpdateTask): Promise<Task> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.task.findFirst({
        where: { id: taskId, userId },
      });
      if (!current) this.throwNotFound();

      const data: Prisma.TaskUncheckedUpdateManyInput = {};
      const changedFields: string[] = [];
      if ('title' in patch) {
        const title = validateTaskTitle(patch.title ?? '');
        if (title !== current.title) {
          data.title = title;
          changedFields.push('title');
        }
      }
      if ('description' in patch) {
        const description = validateTaskDescription(patch.description);
        if (description !== current.description) {
          data.description = description;
          changedFields.push('description');
        }
      }
      if (patch.category && patch.category !== current.category) {
        data.category = patch.category;
        changedFields.push('category');
      }
      if (patch.priority && patch.priority !== current.priority) {
        data.priority = patch.priority;
        changedFields.push('priority');
      }
      if ('estimateMinutes' in patch) {
        const estimate = validateTaskEstimate(patch.estimateMinutes);
        if (estimate !== current.estimateMinutes) {
          data.estimateMinutes = estimate;
          changedFields.push('estimateMinutes');
        }
      }
      if ('dueAt' in patch) {
        const dueAt = validateTaskDueAt(
          patch.dueAt === null || patch.dueAt === undefined
            ? null
            : new Date(patch.dueAt),
        );
        if (dueAt?.getTime() !== current.dueAt?.getTime()) {
          data.dueAt = dueAt;
          changedFields.push('dueAt');
        }
      }
      if ('projectId' in patch && patch.projectId !== current.projectId) {
        data.projectId = patch.projectId ?? null;
        changedFields.push('projectId');
      }
      if (
        'parentTaskId' in patch &&
        patch.parentTaskId !== current.parentTaskId
      ) {
        data.parentTaskId = patch.parentTaskId ?? null;
        changedFields.push('parentTaskId');
      }

      const projectId =
        'projectId' in patch ? (patch.projectId ?? null) : current.projectId;
      const parentTaskId =
        'parentTaskId' in patch
          ? (patch.parentTaskId ?? null)
          : current.parentTaskId;
      await this.validateAssociations(
        transaction,
        userId,
        projectId,
        parentTaskId,
        current.id,
      );
      if (changedFields.length === 0) return toTaskContract(current);

      const update = await transaction.task.updateMany({
        where: { id: current.id, userId, version: current.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (update.count !== 1) this.throwVersionConflict();

      const onlyEstimateChanged =
        changedFields.length === 1 && changedFields[0] === 'estimateMinutes';
      const eventType: TaskEventType = onlyEstimateChanged
        ? 'estimate_changed'
        : 'updated';
      const metadata: Prisma.InputJsonObject = onlyEstimateChanged
        ? {
            fromMinutes: current.estimateMinutes,
            toMinutes: patch.estimateMinutes ?? null,
          }
        : { changedFields };
      await transaction.taskEvent.create({
        data: {
          userId,
          taskId: current.id,
          taskVersion: current.version + 1,
          type: eventType,
          metadata,
          createdAt: this.clock.now(),
        },
      });
      return toTaskContract(
        await transaction.task.findUniqueOrThrow({
          where: { id: current.id },
        }),
      );
    });
  }

  async delete(userId: string, taskId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        const owned = await transaction.task.findFirst({
          where: { id: taskId, userId },
          select: { id: true },
        });
        if (!owned) this.throwNotFound();
        const [subtasks, planItems, focusSessions] = await Promise.all([
          transaction.task.count({ where: { parentTaskId: taskId } }),
          transaction.dailyPlanItem.count({ where: { taskId } }),
          transaction.focusSession.count({ where: { taskId } }),
        ]);
        if (subtasks + planItems + focusSessions > 0) {
          this.throwDeleteConflict();
        }
        // Assistant context is intentionally coarse-grained in the MVP. Purge
        // the owner's retained suggestions before deleting any task so no
        // deleted task text survives inside a plan-context snapshot.
        await transaction.aiSuggestion.deleteMany({ where: { userId } });
        const deleted = await transaction.task.deleteMany({
          where: { id: taskId, userId },
        });
        if (deleted.count !== 1) this.throwNotFound();
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2003'
      ) {
        this.throwDeleteConflict();
      }
      throw error;
    }
  }

  async history(
    userId: string,
    taskId: string,
    query: TaskHistoryQuery,
  ): Promise<TaskHistoryPage> {
    await this.findOwnedTask(userId, taskId);
    if (query.cursor) {
      const cursor = await this.prisma.taskEvent.findFirst({
        where: { id: query.cursor, taskId, userId },
        select: { id: true },
      });
      if (!cursor) this.throwInvalidCursor();
    }
    const events = await this.prisma.taskEvent.findMany({
      where: { taskId, userId },
      orderBy: { taskVersion: 'asc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = events.length > query.limit;
    const items = hasMore ? events.slice(0, query.limit) : events;
    return {
      items: items.map(toTaskEventContract),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private normalizeCreateInput(input: CreateTask): {
    title: string;
    description: string | null;
    estimateMinutes: number | null;
    dueAt: Date | null;
    projectId: string | null;
    parentTaskId: string | null;
  } {
    return {
      title: validateTaskTitle(input.title),
      description: validateTaskDescription(input.description),
      estimateMinutes: validateTaskEstimate(input.estimateMinutes),
      dueAt: validateTaskDueAt(input.dueAt ? new Date(input.dueAt) : null),
      projectId: input.projectId ?? null,
      parentTaskId: input.parentTaskId ?? null,
    };
  }

  private async validateAssociations(
    transaction: Transaction,
    userId: string,
    projectId: string | null,
    parentTaskId: string | null,
    taskId?: string,
  ): Promise<void> {
    if (projectId) {
      const project = await transaction.project.findFirst({
        where: { id: projectId, userId, archivedAt: null },
        select: { id: true },
      });
      if (!project) {
        throw new BadRequestException({
          code: 'INVALID_TASK_PROJECT',
          message: 'Project must be active and owned by the current user.',
        });
      }
    }

    if (!parentTaskId) return;
    if (parentTaskId === taskId) {
      throw new BadRequestException({
        code: 'INVALID_TASK_PARENT',
        message: 'A task cannot be its own parent.',
      });
    }

    let candidateId: string | null = parentTaskId;
    const visited = new Set<string>();
    while (candidateId) {
      if (candidateId === taskId || visited.has(candidateId)) {
        throw new BadRequestException({
          code: 'INVALID_TASK_PARENT',
          message: 'Task parent relationships cannot form a cycle.',
        });
      }
      visited.add(candidateId);
      const candidate: { parentTaskId: string | null } | null =
        await transaction.task.findFirst({
          where: { id: candidateId, userId },
          select: { parentTaskId: true },
        });
      if (!candidate) {
        throw new BadRequestException({
          code: 'INVALID_TASK_PARENT',
          message: 'Parent task must be owned by the current user.',
        });
      }
      candidateId = candidate.parentTaskId;
    }
  }

  private findOwnedTask(userId: string, taskId: string) {
    return this.prisma.task
      .findFirst({ where: { id: taskId, userId } })
      .then((task) => {
        if (!task) this.throwNotFound();
        return task;
      });
  }

  private async assertTaskCursor(
    where: Prisma.TaskWhereInput,
    cursor: string,
  ): Promise<void> {
    const found = await this.prisma.task.findFirst({
      where: { AND: [where, { id: cursor }] },
      select: { id: true },
    });
    if (!found) this.throwInvalidCursor();
  }

  private throwNotFound(): never {
    throw new NotFoundException({
      code: 'TASK_NOT_FOUND',
      message: 'Task was not found.',
    });
  }

  private throwInvalidCursor(): never {
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'Pagination cursor is invalid for this result set.',
    });
  }

  private throwVersionConflict(): never {
    throw new ConflictException({
      code: 'TASK_VERSION_CONFLICT',
      message: 'Task changed before the update could be applied.',
    });
  }

  private throwDeleteConflict(): never {
    throw new ConflictException({
      code: 'TASK_DELETE_CONFLICT',
      message:
        'A task used by subtasks, plan history, or focus history cannot be deleted.',
    });
  }
}
