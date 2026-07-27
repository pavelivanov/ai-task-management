import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { carryoverSignalSchema } from '@execution/contracts';
import type {
  AddDailyPlanItem,
  CarryoverSignal,
  CloseDailyPlan,
  CreateTodayPlan,
  DailyPlan,
  DailyPlanSuggestionOutput,
  DailyPlanRole,
  ResolveCarryover,
  UpdateDailyPlanItem,
  UpdateTodayPlan,
} from '@execution/contracts';
import {
  availableWorkMinutes,
  carryoverSignalForCount,
  localDateForInstant,
  validateLocalDate,
} from '@execution/domain';

import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import type {
  DailyPlan as StoredDailyPlan,
  Prisma,
} from '../../generated/prisma/client';
import { type Clock, CLOCK } from '../auth/clock';
import { InvalidationStreamService } from '../invalidations/invalidation-stream.service';
import { ReviewsService } from '../reviews/reviews.service';
import { TaskLifecycleService } from '../tasks/task-lifecycle.service';
import { TasksService } from '../tasks/tasks.service';
import {
  databaseDate,
  formatLocalTime,
  parseLocalTime,
  toDailyPlanContract,
} from './daily-plan-presenter';
import {
  type DailyPlanCloseGuard,
  DAILY_PLAN_CLOSE_GUARD,
} from './plan-close.guard';

interface PlanningContext {
  timezone: string;
  workdayStart: Date;
  workdayEnd: Date;
  primaryLimit: number;
  secondaryLimit: number;
  overCapacityPercent: number;
}

export interface ScheduleTaskInput {
  planDate?: string;
  role: DailyPlanRole;
  plannedStart?: string | null;
  plannedDurationMinutes?: number | null;
  position?: number;
}

type Transaction = Prisma.TransactionClient;

@Injectable()
export class DailyPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: TaskLifecycleService,
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DAILY_PLAN_CLOSE_GUARD)
    private readonly closeGuard: DailyPlanCloseGuard,
    private readonly invalidations: InvalidationStreamService,
    private readonly reviews: ReviewsService,
    private readonly tasks: TasksService,
  ) {}

  async applySuggestionInTransaction(
    transaction: Transaction,
    userId: string,
    suggestionId: string,
    output: DailyPlanSuggestionOutput,
  ): Promise<{ id: string; version: number }> {
    const preferences = await transaction.userPreferences.findUnique({
      where: { userId },
      include: { user: { select: { timezone: true } } },
    });
    if (!preferences) {
      throw new NotFoundException({
        code: 'PREFERENCES_NOT_FOUND',
        message: 'User preferences were not found.',
      });
    }
    const context: PlanningContext = {
      timezone: preferences.user.timezone,
      workdayStart: preferences.workdayStart,
      workdayEnd: preferences.workdayEnd,
      primaryLimit: preferences.primaryTaskLimit,
      secondaryLimit: preferences.secondaryTaskLimit,
      overCapacityPercent: preferences.capacityWarningPercent,
    };
    const today = localDateForInstant(this.clock.now(), context.timezone);
    let plan = await this.ensurePlan(
      transaction,
      userId,
      output.date,
      output.date === today ? 'active' : 'draft',
      context,
    );

    for (const [position, item] of output.items.entries()) {
      const task = await transaction.task.findFirst({
        where: { id: item.taskId, userId },
        select: { version: true },
      });
      if (!task || task.version !== item.taskVersion) {
        throw new ConflictException({
          code: 'ASSISTANT_SUGGESTION_STALE',
          message: 'A referenced task changed before the plan was applied.',
        });
      }
      await this.addItem(transaction, userId, plan, output.date, context, {
        taskId: item.taskId,
        role: item.role,
        plannedDurationMinutes: item.plannedDurationMinutes,
        position,
      });
      await this.tasks.appendAssistantAcceptanceInTransaction(
        transaction,
        userId,
        item.taskId,
        suggestionId,
        { capability: 'daily_plan', planDate: output.date },
      );
      plan = await transaction.dailyPlan.findUniqueOrThrow({
        where: { id: plan.id },
      });
    }
    return { id: plan.id, version: plan.version };
  }

  async publishPlanChanged(userId: string, planId: string): Promise<void> {
    await this.presentAndPublish(userId, planId);
  }

  async getToday(userId: string): Promise<DailyPlan> {
    const context = await this.getPlanningContext(userId);
    const date = localDateForInstant(this.clock.now(), context.timezone);
    const plan = await this.prisma.dailyPlan.findUnique({
      where: { userId_date: { userId, date: databaseDate(date) } },
      select: { id: true },
    });
    if (!plan) this.throwNotFound();
    return this.present(userId, plan.id);
  }

  async createToday(
    userId: string,
    input: CreateTodayPlan,
  ): Promise<DailyPlan> {
    const context = await this.getPlanningContext(userId);
    const date = localDateForInstant(this.clock.now(), context.timezone);
    const planId = await this.prisma.$transaction(async (transaction) => {
      const plan = await this.ensurePlan(
        transaction,
        userId,
        date,
        input.status,
        context,
      );
      return plan.id;
    });
    return this.presentAndPublish(userId, planId);
  }

  async updateToday(
    userId: string,
    input: UpdateTodayPlan,
  ): Promise<DailyPlan> {
    const context = await this.getPlanningContext(userId);
    const date = localDateForInstant(this.clock.now(), context.timezone);
    const planId = await this.prisma.$transaction(async (transaction) => {
      const plan = await this.findPlan(transaction, userId, date);
      this.assertOpen(plan);
      this.assertVersion(plan, input.expectedVersion);

      const workdayStart =
        input.workdayStart ?? formatLocalTime(plan.workdayStart);
      const workdayEnd = input.workdayEnd ?? formatLocalTime(plan.workdayEnd);
      try {
        availableWorkMinutes(workdayStart, workdayEnd);
      } catch {
        throw new BadRequestException({
          code: 'INVALID_WORKDAY_BOUNDS',
          message: 'Workday end must be after workday start.',
        });
      }

      const update = await transaction.dailyPlan.updateMany({
        where: {
          id: plan.id,
          userId,
          status: { not: 'closed' },
          version: plan.version,
        },
        data: {
          ...(input.status ? { status: input.status } : {}),
          ...(input.workdayStart
            ? { workdayStart: parseLocalTime(input.workdayStart) }
            : {}),
          ...(input.workdayEnd
            ? { workdayEnd: parseLocalTime(input.workdayEnd) }
            : {}),
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) this.throwVersionConflict();
      return plan.id;
    });
    return this.presentAndPublish(userId, planId);
  }

  async addTodayItem(
    userId: string,
    input: AddDailyPlanItem,
  ): Promise<DailyPlan> {
    const context = await this.getPlanningContext(userId);
    const date = localDateForInstant(this.clock.now(), context.timezone);
    const planId = await this.prisma.$transaction(async (transaction) => {
      const plan = await this.findPlan(transaction, userId, date);
      return this.addItem(transaction, userId, plan, date, context, input);
    });
    return this.presentAndPublish(userId, planId);
  }

  async scheduleTask(
    userId: string,
    taskId: string,
    input: ScheduleTaskInput,
  ): Promise<DailyPlan> {
    const context = await this.getPlanningContext(userId);
    const today = localDateForInstant(this.clock.now(), context.timezone);
    const date = validateLocalDate(input.planDate ?? today);
    const planId = await this.prisma.$transaction(async (transaction) => {
      const plan = await this.ensurePlan(
        transaction,
        userId,
        date,
        date === today ? 'active' : 'draft',
        context,
      );
      return this.addItem(transaction, userId, plan, date, context, {
        taskId,
        role: input.role,
        ...(input.plannedStart !== undefined
          ? { plannedStart: input.plannedStart }
          : {}),
        ...(input.plannedDurationMinutes !== undefined
          ? { plannedDurationMinutes: input.plannedDurationMinutes }
          : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      });
    });
    return this.presentAndPublish(userId, planId);
  }

  async scheduleTaskAfterProtectedHours(
    userId: string,
    taskId: string,
    plannedStart: Date,
  ): Promise<DailyPlan> {
    const context = await this.getPlanningContext(userId);
    const date = localDateForInstant(this.clock.now(), context.timezone);
    const existing = await this.prisma.dailyPlan.findUnique({
      where: { userId_date: { userId, date: databaseDate(date) } },
      include: { items: { where: { taskId }, select: { id: true } } },
    });
    const existingItem = existing?.items[0];
    if (existing && existingItem) {
      return this.updateTodayItem(userId, existingItem.id, {
        expectedPlanVersion: existing.version,
        plannedStart: plannedStart.toISOString(),
        role: 'optional',
      });
    }
    return this.scheduleTask(userId, taskId, {
      role: 'optional',
      plannedStart: plannedStart.toISOString(),
    });
  }

  async updateTodayItem(
    userId: string,
    itemId: string,
    input: UpdateDailyPlanItem,
  ): Promise<DailyPlan> {
    const context = await this.getPlanningContext(userId);
    const date = localDateForInstant(this.clock.now(), context.timezone);
    const planId = await this.prisma.$transaction(async (transaction) => {
      const plan = await this.findPlanWithItems(transaction, userId, date);
      this.assertOpen(plan);
      this.assertVersion(plan, input.expectedPlanVersion);
      const item = plan.items.find((candidate) => candidate.id === itemId);
      if (!item) this.throwItemNotFound();
      this.validatePlannedStart(input.plannedStart, date, context.timezone);

      await this.bumpPlanVersion(transaction, plan);
      const data: Prisma.DailyPlanItemUpdateInput = {};
      if (input.role !== undefined) data.role = input.role;
      if (input.plannedStart !== undefined) {
        data.plannedStart = input.plannedStart
          ? new Date(input.plannedStart)
          : null;
      }
      if (input.plannedDurationMinutes !== undefined) {
        data.plannedDurationMinutes = input.plannedDurationMinutes;
      }
      if (input.position !== undefined) {
        const target = Math.min(input.position, plan.items.length - 1);
        if (target < item.position) {
          await transaction.dailyPlanItem.updateMany({
            where: {
              dailyPlanId: plan.id,
              position: { gte: target, lt: item.position },
            },
            data: { position: { increment: 1 } },
          });
        } else if (target > item.position) {
          await transaction.dailyPlanItem.updateMany({
            where: {
              dailyPlanId: plan.id,
              position: { gt: item.position, lte: target },
            },
            data: { position: { decrement: 1 } },
          });
        }
        data.position = target;
      }
      await transaction.dailyPlanItem.update({
        where: { id: item.id },
        data,
      });
      return plan.id;
    });
    return this.presentAndPublish(userId, planId);
  }

  async removeTodayItem(
    userId: string,
    itemId: string,
    expectedPlanVersion: number,
  ): Promise<DailyPlan> {
    const context = await this.getPlanningContext(userId);
    const date = localDateForInstant(this.clock.now(), context.timezone);
    const planId = await this.prisma.$transaction(async (transaction) => {
      const plan = await this.findPlanWithItems(transaction, userId, date);
      this.assertOpen(plan);
      this.assertVersion(plan, expectedPlanVersion);
      const item = plan.items.find((candidate) => candidate.id === itemId);
      if (!item) this.throwItemNotFound();

      await this.bumpPlanVersion(transaction, plan);
      await transaction.dailyPlanItem.delete({ where: { id: item.id } });
      await transaction.dailyPlanItem.updateMany({
        where: { dailyPlanId: plan.id, position: { gt: item.position } },
        data: { position: { decrement: 1 } },
      });
      const otherOpenPlans = await transaction.dailyPlanItem.count({
        where: {
          taskId: item.taskId,
          dailyPlan: { status: { not: 'closed' } },
        },
      });
      await this.lifecycle.unscheduleInTransaction(transaction, {
        taskId: item.taskId,
        userId,
        dailyPlanId: plan.id,
        planDate: date,
        returnToBacklog: otherOpenPlans === 0,
      });
      return plan.id;
    });
    return this.presentAndPublish(userId, planId);
  }

  async closeToday(userId: string, input: CloseDailyPlan): Promise<DailyPlan> {
    const context = await this.getPlanningContext(userId);
    const date = localDateForInstant(this.clock.now(), context.timezone);
    const planId = await this.prisma.$transaction(async (transaction) => {
      const plan = await this.findPlanWithItemsAndTasks(
        transaction,
        userId,
        date,
      );
      if (plan.status === 'closed') {
        await this.reviews.generateInTransaction(transaction, userId, date);
        return plan.id;
      }
      if (
        input.expectedPlanVersion !== undefined &&
        input.expectedPlanVersion !== plan.version
      ) {
        this.throwVersionConflict();
      }
      await this.closeGuard.assertCanClose(transaction, userId);

      const carryoverSignals: CarryoverSignal[] = [];
      for (const item of plan.items) {
        if (item.task.status === 'completed') {
          const completedDuringDay = Boolean(
            item.task.completedAt &&
            localDateForInstant(item.task.completedAt, context.timezone) ===
              date,
          );
          if (item.completedDuringDay !== completedDuringDay) {
            await transaction.dailyPlanItem.update({
              where: { id: item.id },
              data: { completedDuringDay },
            });
          }
          continue;
        }
        if (
          !['planned', 'in_progress', 'waiting', 'blocked'].includes(
            item.task.status,
          )
        ) {
          continue;
        }
        const carried = await this.lifecycle.carryOverInTransaction(
          transaction,
          {
            taskId: item.taskId,
            userId,
            dailyPlanId: plan.id,
            planDate: date,
          },
        );
        carryoverSignals.push({
          taskId: item.taskId,
          count: carried.carryoverCount,
          level: carryoverSignalForCount(carried.carryoverCount, {
            warning: this.config.carryoverWarningCount,
            diagnosis: this.config.carryoverDiagnosisCount,
            explicitChoice: this.config.carryoverExplicitChoiceCount,
          }),
        });
      }

      const closed = await transaction.dailyPlan.updateMany({
        where: {
          id: plan.id,
          userId,
          status: { not: 'closed' },
          version: plan.version,
        },
        data: {
          status: 'closed',
          closedAt: this.clock.now(),
          carryoverSignals:
            carryoverSignals as unknown as Prisma.InputJsonArray,
          version: { increment: 1 },
        },
      });
      if (closed.count !== 1) this.throwVersionConflict();
      await this.reviews.generateInTransaction(transaction, userId, date);
      return plan.id;
    });
    return this.presentAndPublish(userId, planId);
  }

  async resolveTodayCarryover(
    userId: string,
    taskId: string,
    input: ResolveCarryover,
  ): Promise<DailyPlan> {
    const context = await this.getPlanningContext(userId);
    const date = localDateForInstant(this.clock.now(), context.timezone);
    const planId = await this.prisma.$transaction(async (transaction) => {
      const plan = await this.findPlanWithItemsAndTasks(
        transaction,
        userId,
        date,
      );
      if (plan.status !== 'closed') {
        throw new ConflictException({
          code: 'DAILY_PLAN_NOT_CLOSED',
          message: 'Carryover choices are available after the day is closed.',
        });
      }
      const parsedSignals = carryoverSignalSchema
        .array()
        .safeParse(plan.carryoverSignals);
      if (!parsedSignals.success) {
        throw new ConflictException({
          code: 'CARRYOVER_SIGNALS_INVALID',
          message: 'The recorded carryover choices could not be read.',
        });
      }
      const signalIndex = parsedSignals.data.findIndex(
        (signal) => signal.taskId === taskId,
      );
      const signal = parsedSignals.data[signalIndex];
      if (!signal) {
        throw new NotFoundException({
          code: 'CARRYOVER_SIGNAL_NOT_FOUND',
          message: 'The carryover choice was not found.',
        });
      }
      if (signal.level !== 'explicit_choice') {
        throw new BadRequestException({
          code: 'CARRYOVER_CHOICE_NOT_REQUIRED',
          message: 'This task does not require an explicit carryover choice.',
        });
      }
      if (signal.resolution) return plan.id;
      this.assertVersion(plan, input.expectedPlanVersion);

      const item = plan.items.find((candidate) => candidate.taskId === taskId);
      if (!item) this.throwItemNotFound();
      switch (input.action) {
        case 'break_down':
          for (const title of input.subtasks) {
            await this.tasks.createInTransaction(transaction, userId, {
              title,
              category: item.task.category,
              priority: item.task.priority,
              parentTaskId: item.task.id,
              ...(item.task.projectId
                ? { projectId: item.task.projectId }
                : {}),
            });
          }
          break;
        case 'postpone':
          if (new Date(input.dueAt).getTime() <= this.clock.now().getTime()) {
            throw new BadRequestException({
              code: 'CARRYOVER_POSTPONE_DATE_INVALID',
              message: 'A postponed task must use a future date.',
            });
          }
          await this.tasks.updateInTransaction(transaction, userId, taskId, {
            dueAt: input.dueAt,
          });
          break;
        case 'archive':
          await this.lifecycle.transitionInTransaction(transaction, {
            taskId,
            userId,
            to: 'archived',
            reason: 'Resolved after repeated carryover.',
            metadata: { dailyPlanId: plan.id },
          });
          break;
        case 'recommit':
          break;
      }

      const resolution = {
        action: input.action,
        resolvedAt: this.clock.now().toISOString(),
      } as const;
      const carryoverSignals = parsedSignals.data.map((candidate, index) =>
        index === signalIndex ? { ...candidate, resolution } : candidate,
      );
      const updated = await transaction.dailyPlan.updateMany({
        where: {
          id: plan.id,
          userId,
          status: 'closed',
          version: plan.version,
        },
        data: {
          carryoverSignals:
            carryoverSignals as unknown as Prisma.InputJsonArray,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) this.throwVersionConflict();
      return plan.id;
    });
    return this.presentAndPublish(userId, planId);
  }

  async markTaskCompletedInTransaction(
    transaction: Transaction,
    userId: string,
    taskId: string,
    completedAt: Date,
  ): Promise<{ id: string; version: number } | null> {
    const preferences = await transaction.userPreferences.findUnique({
      where: { userId },
      include: { user: { select: { timezone: true } } },
    });
    if (!preferences) return null;
    const date = localDateForInstant(completedAt, preferences.user.timezone);
    const plan = await transaction.dailyPlan.findUnique({
      where: { userId_date: { userId, date: databaseDate(date) } },
      include: { items: { where: { taskId } } },
    });
    const item = plan?.items[0];
    if (!plan || plan.status === 'closed' || !item?.id) return null;
    if (item.completedDuringDay) return null;

    const updated = await transaction.dailyPlan.updateMany({
      where: {
        id: plan.id,
        userId,
        status: { not: 'closed' },
        version: plan.version,
      },
      data: { version: { increment: 1 } },
    });
    if (updated.count !== 1) this.throwVersionConflict();
    await transaction.dailyPlanItem.update({
      where: { id: item.id },
      data: { completedDuringDay: true },
    });
    return { id: plan.id, version: plan.version + 1 };
  }

  private async addItem(
    transaction: Transaction,
    userId: string,
    plan: StoredDailyPlan,
    date: string,
    context: PlanningContext,
    input: AddDailyPlanItem,
  ): Promise<string> {
    this.assertOpen(plan);
    const task = await transaction.task.findFirst({
      where: { id: input.taskId, userId },
      select: { id: true },
    });
    if (!task) {
      throw new NotFoundException({
        code: 'TASK_NOT_FOUND',
        message: 'Task was not found.',
      });
    }
    const existing = await transaction.dailyPlanItem.findUnique({
      where: {
        dailyPlanId_taskId: { dailyPlanId: plan.id, taskId: input.taskId },
      },
    });
    if (existing) return plan.id;
    if (
      input.expectedPlanVersion !== undefined &&
      input.expectedPlanVersion !== plan.version
    ) {
      this.throwVersionConflict();
    }
    this.validatePlannedStart(input.plannedStart, date, context.timezone);

    const itemCount = await transaction.dailyPlanItem.count({
      where: { dailyPlanId: plan.id },
    });
    const position = Math.min(input.position ?? itemCount, itemCount);
    await this.bumpPlanVersion(transaction, plan);
    await transaction.dailyPlanItem.updateMany({
      where: { dailyPlanId: plan.id, position: { gte: position } },
      data: { position: { increment: 1 } },
    });
    await transaction.dailyPlanItem.create({
      data: {
        dailyPlanId: plan.id,
        taskId: input.taskId,
        role: input.role,
        plannedStart: input.plannedStart ? new Date(input.plannedStart) : null,
        plannedDurationMinutes: input.plannedDurationMinutes ?? null,
        position,
        addedDuringDay:
          plan.status === 'active' &&
          date === localDateForInstant(this.clock.now(), context.timezone),
      },
    });
    await this.lifecycle.scheduleInTransaction(transaction, {
      taskId: input.taskId,
      userId,
      dailyPlanId: plan.id,
      planDate: date,
    });
    return plan.id;
  }

  private async present(userId: string, planId: string): Promise<DailyPlan> {
    const [plan, context] = await Promise.all([
      this.prisma.dailyPlan.findFirst({
        where: { id: planId, userId },
        include: {
          items: {
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            include: { task: true },
          },
        },
      }),
      this.getPlanningContext(userId),
    ]);
    if (!plan) this.throwNotFound();
    return toDailyPlanContract(plan, context);
  }

  private async presentAndPublish(
    userId: string,
    planId: string,
  ): Promise<DailyPlan> {
    const plan = await this.present(userId, planId);
    this.invalidations.publish(userId, {
      type: 'plan.changed',
      resourceId: plan.id,
      resourceVersion: plan.version,
    });
    return plan;
  }

  private async getPlanningContext(userId: string): Promise<PlanningContext> {
    const preferences = await this.prisma.userPreferences.findUnique({
      where: { userId },
      include: { user: { select: { timezone: true } } },
    });
    if (!preferences) {
      throw new NotFoundException({
        code: 'PREFERENCES_NOT_FOUND',
        message: 'User preferences were not found.',
      });
    }
    return {
      timezone: preferences.user.timezone,
      workdayStart: preferences.workdayStart,
      workdayEnd: preferences.workdayEnd,
      primaryLimit: preferences.primaryTaskLimit,
      secondaryLimit: preferences.secondaryTaskLimit,
      overCapacityPercent: preferences.capacityWarningPercent,
    };
  }

  private async ensurePlan(
    transaction: Transaction,
    userId: string,
    date: string,
    status: 'draft' | 'active',
    context: PlanningContext,
  ): Promise<StoredDailyPlan> {
    return transaction.dailyPlan.upsert({
      where: { userId_date: { userId, date: databaseDate(date) } },
      update: {},
      create: {
        userId,
        date: databaseDate(date),
        workdayStart: context.workdayStart,
        workdayEnd: context.workdayEnd,
        status,
        createdAt: this.clock.now(),
        updatedAt: this.clock.now(),
      },
    });
  }

  private async findPlan(
    transaction: Transaction,
    userId: string,
    date: string,
  ): Promise<StoredDailyPlan> {
    const plan = await transaction.dailyPlan.findUnique({
      where: { userId_date: { userId, date: databaseDate(date) } },
    });
    if (!plan) this.throwNotFound();
    return plan;
  }

  private async findPlanWithItems(
    transaction: Transaction,
    userId: string,
    date: string,
  ) {
    const plan = await transaction.dailyPlan.findUnique({
      where: { userId_date: { userId, date: databaseDate(date) } },
      include: { items: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
    });
    if (!plan) this.throwNotFound();
    return plan;
  }

  private async findPlanWithItemsAndTasks(
    transaction: Transaction,
    userId: string,
    date: string,
  ) {
    const plan = await transaction.dailyPlan.findUnique({
      where: { userId_date: { userId, date: databaseDate(date) } },
      include: {
        items: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          include: { task: true },
        },
      },
    });
    if (!plan) this.throwNotFound();
    return plan;
  }

  private async bumpPlanVersion(
    transaction: Transaction,
    plan: Pick<StoredDailyPlan, 'id' | 'userId' | 'version'>,
  ): Promise<void> {
    const update = await transaction.dailyPlan.updateMany({
      where: {
        id: plan.id,
        userId: plan.userId,
        status: { not: 'closed' },
        version: plan.version,
      },
      data: { version: { increment: 1 } },
    });
    if (update.count !== 1) this.throwVersionConflict();
  }

  private validatePlannedStart(
    plannedStart: string | null | undefined,
    date: string,
    timezone: string,
  ): void {
    if (!plannedStart) return;
    if (localDateForInstant(new Date(plannedStart), timezone) !== date) {
      throw new BadRequestException({
        code: 'PLANNED_START_OUTSIDE_PLAN_DATE',
        message:
          'Planned start must fall on the plan date in the user timezone.',
      });
    }
  }

  private assertOpen(plan: Pick<StoredDailyPlan, 'status'>): void {
    if (plan.status === 'closed') {
      throw new ConflictException({
        code: 'DAILY_PLAN_CLOSED',
        message: 'A closed daily plan cannot be changed.',
      });
    }
  }

  private assertVersion(
    plan: Pick<StoredDailyPlan, 'version'>,
    expectedVersion: number,
  ): void {
    if (plan.version !== expectedVersion) this.throwVersionConflict();
  }

  private throwNotFound(): never {
    throw new NotFoundException({
      code: 'DAILY_PLAN_NOT_FOUND',
      message: 'Daily plan was not found.',
    });
  }

  private throwItemNotFound(): never {
    throw new NotFoundException({
      code: 'DAILY_PLAN_ITEM_NOT_FOUND',
      message: 'Daily plan item was not found.',
    });
  }

  private throwVersionConflict(): never {
    throw new ConflictException({
      code: 'DAILY_PLAN_VERSION_CONFLICT',
      message: 'Daily plan changed before the mutation could be applied.',
    });
  }
}
