import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CaptureFocusDistraction,
  CompleteFocusSession,
  CurrentFocusSession,
  DailyPlan,
  FocusReason,
  FocusSession,
  FocusSessionStatus,
  StartFocusSession,
  StopFocusSession,
  Task,
  TaskStatus,
  WaitForFocusSession,
} from '@execution/contracts';
import {
  evaluateProtectedStart,
  FocusTransitionError,
  isInsideProtectedHours,
  localDateForInstant,
  scheduleAfterProtectedHours,
  transitionFocusSession,
} from '@execution/domain';

import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { type Clock, CLOCK } from '../auth/clock';
import { DailyPlansService } from '../daily-plans/daily-plans.service';
import {
  databaseDate,
  formatLocalTime,
} from '../daily-plans/daily-plan-presenter';
import { InvalidationStreamService } from '../invalidations/invalidation-stream.service';
import { TaskLifecycleService } from '../tasks/task-lifecycle.service';
import { TasksService } from '../tasks/tasks.service';
import {
  type FocusActivationHook,
  FOCUS_ACTIVATION_HOOK,
} from './focus-activation.hook';
import {
  safeCurrentSessionSummary,
  toFocusSessionContract,
} from './focus-presenter';

type Transaction = Prisma.TransactionClient;

interface FocusMutationResult {
  id: string;
  changed: boolean;
  planChanged: { id: string; version: number } | null;
}

interface TransitionOptions {
  taskStatus: TaskStatus;
  reason?: string;
  outcome?: string;
  eventTypeOverride?: 'resumed';
  expectedWaitMinutes?: number;
}

@Injectable()
export class FocusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: TaskLifecycleService,
    private readonly dailyPlans: DailyPlansService,
    private readonly tasks: TasksService,
    private readonly invalidations: InvalidationStreamService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FOCUS_ACTIVATION_HOOK)
    private readonly activationHook: FocusActivationHook,
  ) {}

  async current(userId: string): Promise<CurrentFocusSession> {
    const session = await this.prisma.focusSession.findFirst({
      where: {
        userId,
        status: { in: ['active', 'paused', 'waiting', 'blocked'] },
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      include: {
        segments: { orderBy: { sequence: 'asc' } },
        task: true,
      },
    });
    return session ? toFocusSessionContract(session, this.clock.now()) : null;
  }

  async start(userId: string, input: StartFocusSession): Promise<FocusSession> {
    let result: FocusMutationResult;
    try {
      result = await this.prisma.$transaction(async (transaction) => {
        const current = await this.findOpenSummary(transaction, userId);
        if (current) {
          if (current.taskId === input.taskId) {
            return { id: current.id, changed: false, planChanged: null };
          }
          this.throwActiveConflict(current);
        }

        const task = await transaction.task.findFirst({
          where: { id: input.taskId, userId },
          select: { id: true, status: true, category: true, priority: true },
        });
        if (!task) this.throwTaskNotFound();
        if (task.status === 'inbox') {
          throw new ConflictException({
            code: 'FOCUS_TASK_INBOX',
            message: 'Process an inbox task before starting focus.',
          });
        }
        if (task.status !== 'backlog' && task.status !== 'planned') {
          throw new ConflictException({
            code: 'FOCUS_TASK_NOT_STARTABLE',
            message: 'Only backlog or planned tasks can start focus.',
          });
        }

        const protectedDecision = await this.protectedStartDecision(
          transaction,
          userId,
          task,
        );
        if (
          protectedDecision.confirmationRequired &&
          !input.protectedHoursOverride
        ) {
          throw new ConflictException({
            code: 'PROTECTED_HOURS_CONFIRMATION_REQUIRED',
            message: 'This is a personal task during protected work hours.',
            scheduleAfterWorkAt: protectedDecision.scheduleAfterWorkAt,
          });
        }

        await this.activationHook.beforeActivate(userId);
        const now = this.clock.now();
        const session = await transaction.focusSession.create({
          data: {
            userId,
            taskId: input.taskId,
            status: 'active',
            startedAt: now,
            initialIntent: input.initialIntent ?? null,
            createdAt: now,
            updatedAt: now,
            segments: {
              create: {
                sequence: 0,
                type: 'focused',
                startedAt: now,
                createdAt: now,
              },
            },
          },
        });
        await this.lifecycle.transitionInTransaction(transaction, {
          taskId: task.id,
          userId,
          to: 'in_progress',
          metadata: { focusSessionId: session.id },
        });
        return { id: session.id, changed: true, planChanged: null };
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const current = await this.findOpenSummary(this.prisma, userId);
      if (current?.taskId === input.taskId) {
        result = { id: current.id, changed: false, planChanged: null };
      } else if (current) {
        this.throwActiveConflict(current);
      } else {
        throw error;
      }
    }
    return this.presentAndPublish(userId, result);
  }

  pause(
    userId: string,
    sessionId: string,
    input: FocusReason,
  ): Promise<FocusSession> {
    return this.mutateAndPresent(userId, sessionId, 'paused', {
      taskStatus: 'backlog',
      ...(input.reason ? { reason: input.reason } : {}),
    });
  }

  resume(userId: string, sessionId: string): Promise<FocusSession> {
    return this.mutateAndPresent(userId, sessionId, 'active', {
      taskStatus: 'in_progress',
      eventTypeOverride: 'resumed',
    });
  }

  wait(
    userId: string,
    sessionId: string,
    input: WaitForFocusSession,
  ): Promise<FocusSession> {
    return this.mutateAndPresent(userId, sessionId, 'waiting', {
      taskStatus: 'waiting',
      ...(input.reason ? { reason: input.reason } : {}),
      expectedWaitMinutes: input.expectedWaitMinutes,
    });
  }

  async scheduleAfterProtectedHours(
    userId: string,
    taskId: string,
  ): Promise<DailyPlan> {
    const preferences = await this.prisma.userPreferences.findUnique({
      where: { userId },
      include: { user: { select: { timezone: true } } },
    });
    if (!preferences || !preferences.protectedHoursEnabled) {
      throw new ConflictException({
        code: 'PROTECTED_HOURS_DISABLED',
        message: 'Protected hours are not enabled.',
      });
    }
    const plannedStart = scheduleAfterProtectedHours({
      now: this.clock.now(),
      timeZone: preferences.user.timezone,
      enabled: true,
      start: preferences.protectedHoursStart
        ? formatLocalTime(preferences.protectedHoursStart)
        : null,
      end: preferences.protectedHoursEnd
        ? formatLocalTime(preferences.protectedHoursEnd)
        : null,
    });
    return this.dailyPlans.scheduleTaskAfterProtectedHours(
      userId,
      taskId,
      plannedStart,
    );
  }

  async captureDistraction(
    userId: string,
    sessionId: string,
    input: CaptureFocusDistraction,
  ): Promise<Task> {
    return this.prisma.$transaction(async (transaction) => {
      const session = await transaction.focusSession.findFirst({
        where: {
          id: sessionId,
          userId,
          status: { in: ['active', 'paused', 'waiting', 'blocked'] },
        },
        select: { id: true },
      });
      if (!session) this.throwSessionNotFound();
      return this.tasks.createInTransaction(
        transaction,
        userId,
        {
          title: input.title,
          category: 'work',
          priority: 'normal',
        },
        'inbox',
        { source: 'focus_distraction', focusSessionId: session.id },
      );
    });
  }

  block(
    userId: string,
    sessionId: string,
    input: FocusReason,
  ): Promise<FocusSession> {
    return this.mutateAndPresent(userId, sessionId, 'blocked', {
      taskStatus: 'blocked',
      ...(input.reason ? { reason: input.reason } : {}),
    });
  }

  complete(
    userId: string,
    sessionId: string,
    input: CompleteFocusSession,
  ): Promise<FocusSession> {
    return this.mutateAndPresent(userId, sessionId, 'completed', {
      taskStatus: 'completed',
      outcome: input.outcome,
    });
  }

  stop(
    userId: string,
    sessionId: string,
    input: StopFocusSession,
  ): Promise<FocusSession> {
    return this.mutateAndPresent(userId, sessionId, 'stopped', {
      taskStatus: input.taskStatus,
      ...(input.reason ? { reason: input.reason } : {}),
    });
  }

  private async mutateAndPresent(
    userId: string,
    sessionId: string,
    target: FocusSessionStatus,
    options: TransitionOptions,
  ): Promise<FocusSession> {
    let result: FocusMutationResult;
    try {
      result = await this.prisma.$transaction((transaction) =>
        this.transitionInTransaction(
          transaction,
          userId,
          sessionId,
          target,
          options,
        ),
      );
    } catch (error) {
      if (!this.isUniqueViolation(error) || target !== 'active') throw error;
      const current = await this.findActiveSummary(this.prisma, userId);
      if (current?.id === sessionId) {
        result = { id: current.id, changed: false, planChanged: null };
      } else if (current) {
        this.throwActiveConflict(current);
      } else {
        throw error;
      }
    }
    return this.presentAndPublish(userId, result);
  }

  private async transitionInTransaction(
    transaction: Transaction,
    userId: string,
    sessionId: string,
    target: FocusSessionStatus,
    options: TransitionOptions,
  ): Promise<FocusMutationResult> {
    const session = await transaction.focusSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        segments: { orderBy: { sequence: 'desc' }, take: 1 },
        task: { select: { status: true } },
      },
    });
    if (!session) this.throwSessionNotFound();
    const transition = this.resolveTransition(session.status, target);
    if (transition.noop) {
      return { id: session.id, changed: false, planChanged: null };
    }

    if (target === 'active') {
      const current = await this.findActiveSummary(transaction, userId);
      if (current && current.id !== session.id)
        this.throwActiveConflict(current);
      await this.activationHook.beforeActivate(userId);
    }
    const latestSegment = session.segments[0];
    this.assertOpenSegment(session.status, latestSegment);

    const now = this.clock.now();
    const update = await transaction.focusSession.updateMany({
      where: {
        id: session.id,
        userId,
        status: session.status,
        version: session.version,
      },
      data: {
        status: target,
        version: { increment: 1 },
        endedAt: transition.terminal ? now : null,
        ...(options.outcome ? { outcome: options.outcome } : {}),
        ...(options.reason ? { interruptionReason: options.reason } : {}),
        ...(target === 'waiting'
          ? { expectedWaitMinutes: options.expectedWaitMinutes ?? 5 }
          : {}),
      },
    });
    if (update.count !== 1) {
      const latest = await transaction.focusSession.findFirst({
        where: { id: session.id, userId },
        select: { status: true },
      });
      if (latest?.status === target) {
        return { id: session.id, changed: false, planChanged: null };
      }
      this.throwVersionConflict();
    }

    if (latestSegment?.endedAt === null) {
      await transaction.focusSessionSegment.update({
        where: { id: latestSegment.id },
        data: { endedAt: now },
      });
    }
    if (transition.openSegmentType) {
      await transaction.focusSessionSegment.create({
        data: {
          focusSessionId: session.id,
          sequence: (latestSegment?.sequence ?? -1) + 1,
          type: transition.openSegmentType,
          startedAt: now,
          createdAt: now,
        },
      });
    }

    if (session.task.status !== options.taskStatus) {
      await this.lifecycle.transitionInTransaction(transaction, {
        taskId: session.taskId,
        userId,
        to: options.taskStatus,
        metadata: { focusSessionId: session.id },
        ...(options.reason ? { reason: options.reason } : {}),
        ...(options.eventTypeOverride
          ? { eventTypeOverride: options.eventTypeOverride }
          : {}),
      });
    }
    const planChanged =
      target === 'completed'
        ? await this.dailyPlans.markTaskCompletedInTransaction(
            transaction,
            userId,
            session.taskId,
            now,
          )
        : null;
    return { id: session.id, changed: true, planChanged };
  }

  private async presentAndPublish(
    userId: string,
    result: FocusMutationResult,
  ): Promise<FocusSession> {
    const session = await this.present(userId, result.id);
    if (result.changed) {
      this.invalidations.publish(userId, {
        type: 'focus.changed',
        resourceId: session.id,
        resourceVersion: session.version,
      });
      if (result.planChanged) {
        this.invalidations.publish(userId, {
          type: 'plan.changed',
          resourceId: result.planChanged.id,
          resourceVersion: result.planChanged.version,
        });
      }
    }
    return session;
  }

  private async protectedStartDecision(
    transaction: Transaction,
    userId: string,
    task: {
      id: string;
      category: 'work' | 'personal';
      priority: 'low' | 'normal' | 'high' | 'critical';
    },
  ): Promise<{
    confirmationRequired: boolean;
    scheduleAfterWorkAt: string | null;
  }> {
    const preferences = await transaction.userPreferences.findUnique({
      where: { userId },
      include: { user: { select: { timezone: true } } },
    });
    if (!preferences)
      return { confirmationRequired: false, scheduleAfterWorkAt: null };
    const now = this.clock.now();
    const start = preferences.protectedHoursStart
      ? formatLocalTime(preferences.protectedHoursStart)
      : null;
    const end = preferences.protectedHoursEnd
      ? formatLocalTime(preferences.protectedHoursEnd)
      : null;
    const localDate = localDateForInstant(now, preferences.user.timezone);
    const plannedItem = await transaction.dailyPlanItem.findFirst({
      where: {
        taskId: task.id,
        plannedStart: { not: null },
        dailyPlan: { userId, date: databaseDate(localDate) },
      },
      select: { plannedStart: true },
    });
    const plannedPersonalAdmin =
      plannedItem?.plannedStart !== null &&
      plannedItem?.plannedStart !== undefined &&
      isInsideProtectedHours({
        now: plannedItem.plannedStart,
        timeZone: preferences.user.timezone,
        enabled: preferences.protectedHoursEnabled,
        start,
        end,
      });
    const hours = {
      now,
      timeZone: preferences.user.timezone,
      enabled: preferences.protectedHoursEnabled,
      start,
      end,
    };
    const decision = evaluateProtectedStart(hours, {
      category: task.category,
      priority: task.priority,
      plannedPersonalAdmin,
    });
    return {
      confirmationRequired: decision.confirmationRequired,
      scheduleAfterWorkAt: decision.confirmationRequired
        ? scheduleAfterProtectedHours(hours).toISOString()
        : null,
    };
  }

  private async present(
    userId: string,
    sessionId: string,
  ): Promise<FocusSession> {
    const session = await this.prisma.focusSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        segments: { orderBy: { sequence: 'asc' } },
        task: true,
      },
    });
    if (!session) this.throwSessionNotFound();
    return toFocusSessionContract(session, this.clock.now());
  }

  private findActiveSummary(
    database: Transaction | PrismaService,
    userId: string,
  ) {
    return database.focusSession.findFirst({
      where: { userId, status: 'active' },
      select: {
        id: true,
        taskId: true,
        status: true,
        version: true,
        startedAt: true,
      },
    });
  }

  private findOpenSummary(
    database: Transaction | PrismaService,
    userId: string,
  ) {
    return database.focusSession.findFirst({
      where: {
        userId,
        status: { in: ['active', 'paused', 'waiting', 'blocked'] },
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        taskId: true,
        status: true,
        version: true,
        startedAt: true,
      },
    });
  }

  private assertOpenSegment(
    status: FocusSessionStatus,
    segment: { type: string; endedAt: Date | null } | undefined,
  ): void {
    const expected =
      status === 'active'
        ? 'focused'
        : status === 'paused'
          ? 'paused'
          : status === 'waiting'
            ? 'waiting'
            : null;
    if (
      (expected && (segment?.type !== expected || segment.endedAt !== null)) ||
      (!expected && segment?.endedAt === null)
    ) {
      throw new ConflictException({
        code: 'FOCUS_SEGMENT_INVARIANT',
        message: 'Focus timing segments are inconsistent with session state.',
      });
    }
  }

  private resolveTransition(from: FocusSessionStatus, to: FocusSessionStatus) {
    try {
      return transitionFocusSession(from, to);
    } catch (error) {
      if (error instanceof FocusTransitionError) {
        throw new ConflictException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private throwActiveConflict(session: {
    id: string;
    taskId: string;
    status: string;
    version: number;
    startedAt: Date;
  }): never {
    throw new ConflictException({
      code: 'ACTIVE_FOCUS_SESSION_EXISTS',
      message: 'Another focus session is already active.',
      currentSession: safeCurrentSessionSummary(session),
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }

  private throwTaskNotFound(): never {
    throw new NotFoundException({
      code: 'TASK_NOT_FOUND',
      message: 'Task was not found.',
    });
  }

  private throwSessionNotFound(): never {
    throw new NotFoundException({
      code: 'FOCUS_SESSION_NOT_FOUND',
      message: 'Focus session was not found.',
    });
  }

  private throwVersionConflict(): never {
    throw new ConflictException({
      code: 'FOCUS_VERSION_CONFLICT',
      message: 'Focus session changed before the command was applied.',
    });
  }
}
