import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  AssistantTriggerType,
  NotificationType,
} from '@execution/contracts';
import {
  analyzePlan,
  localDateForInstant,
  localMinuteForInstant,
  triggerDedupeKey,
} from '@execution/domain';

import { AppConfig } from '../../config/app-config.service';
import { StructuredLogger } from '../../common/observability/structured-logger.service';
import { runSafeBackgroundTask } from '../../common/runtime/safe-background-task';
import { PrismaService } from '../../database/prisma.service';
import { type Clock, CLOCK } from '../auth/clock';
import {
  databaseDate,
  formatLocalTime,
} from '../daily-plans/daily-plan-presenter';
import { NotificationsService } from './notifications.service';

type InterruptionLevel = 'minimal' | 'balanced' | 'proactive';

interface TriggerCandidate {
  type: AssistantTriggerType;
  notificationType: NotificationType;
  window: string;
  relatedTaskId?: string;
  title: string;
  body: string;
  deepLink: string;
  minimumLevel: InterruptionLevel;
  explicitlyEnabled?: boolean;
}

const LEVEL_ORDER: Record<InterruptionLevel, number> = {
  minimal: 0,
  balanced: 1,
  proactive: 2,
};

@Injectable()
export class BehaviorSchedulerService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly notifications: NotificationsService,
    private readonly logger: StructuredLogger,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () =>
        void runSafeBackgroundTask({
          failureEvent: 'behavior.scheduler.loop_failed',
          logger: this.logger,
          task: () => this.runOnce(),
        }),
      this.config.behaviorSchedulerIntervalMs,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const users = await this.prisma.user.findMany({
        where: { disabledAt: null },
        include: { preferences: true },
        take: 1_000,
      });
      let created = 0;
      for (const user of users) {
        if (!user.preferences) continue;
        created += await this.evaluateUser(user.id);
      }
      return created;
    } finally {
      this.running = false;
    }
  }

  async evaluateUser(userId: string): Promise<number> {
    const now = this.clock.now();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { preferences: true },
    });
    if (!user?.preferences) return 0;
    const preferences = user.preferences;
    const localDate = localDateForInstant(now, user.timezone);
    const localMinute = localMinuteForInstant(now, user.timezone);
    const workdayStart = formatLocalTime(preferences.workdayStart);
    const workdayEnd = formatLocalTime(preferences.workdayEnd);
    const startMinute = this.minute(workdayStart);
    const endMinute = this.minute(workdayEnd);
    const dateValue = databaseDate(localDate);
    const [plan, review, carriedTasks, dueTasks, openSessions] =
      await Promise.all([
        this.prisma.dailyPlan.findUnique({
          where: { userId_date: { userId, date: dateValue } },
          include: { items: { include: { task: true } } },
        }),
        this.prisma.dailyReview.findUnique({
          where: { userId_date: { userId, date: dateValue } },
          select: { id: true },
        }),
        this.prisma.task.findMany({
          where: {
            userId,
            carryoverCount: { gte: this.config.carryoverDiagnosisCount },
            status: { notIn: ['completed', 'cancelled', 'archived'] },
          },
          orderBy: [{ carryoverCount: 'desc' }, { id: 'asc' }],
          take: 50,
        }),
        this.prisma.task.findMany({
          where: {
            userId,
            dueAt: { gt: now, lte: new Date(now.getTime() + 24 * 60 * 60_000) },
            status: { notIn: ['completed', 'cancelled', 'archived'] },
          },
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          take: 50,
        }),
        this.prisma.focusSession.findMany({
          where: { userId, status: { in: ['active', 'paused', 'waiting'] } },
          include: {
            task: true,
            segments: { orderBy: { sequence: 'asc' } },
          },
          take: 10,
        }),
      ]);

    const candidates: TriggerCandidate[] = [];
    if (localMinute >= startMinute && localMinute < endMinute && !plan) {
      candidates.push({
        type: 'morning_plan_missing',
        notificationType: 'morning_plan',
        window: localDate,
        title: 'Choose today’s outcome',
        body: 'Your workday has started without an active plan.',
        deepLink: '/today',
        minimumLevel: 'minimal',
        explicitlyEnabled: preferences.morningPlanningReminder,
      });
    }
    if (localMinute >= endMinute && !review) {
      candidates.push({
        type: 'end_of_day_review',
        notificationType: 'end_of_day_review',
        window: localDate,
        title: 'Close the working day',
        body: 'A short factual review is ready to generate.',
        deepLink: '/review',
        minimumLevel: 'minimal',
        explicitlyEnabled: preferences.endOfDayReminder,
      });
    }
    if (plan) {
      const analysis = analyzePlan(
        formatLocalTime(plan.workdayStart),
        formatLocalTime(plan.workdayEnd),
        plan.items.map((item) => ({
          id: item.id,
          taskId: item.taskId,
          role: item.role,
          position: item.position,
          plannedDurationMinutes: item.plannedDurationMinutes,
          taskEstimateMinutes: item.task.estimateMinutes,
        })),
        {
          primaryLimit: preferences.primaryTaskLimit,
          secondaryLimit: preferences.secondaryTaskLimit,
          overCapacityPercent: preferences.capacityWarningPercent,
        },
      );
      if (analysis.warnings.some(({ code }) => code === 'OVER_CAPACITY')) {
        candidates.push({
          type: 'plan_over_capacity',
          notificationType: 'plan_over_capacity',
          window: localDate,
          title: 'Today is over capacity',
          body: 'Reduce or defer work before the plan becomes a queue.',
          deepLink: '/today',
          minimumLevel: 'balanced',
        });
      }
    }
    for (const task of carriedTasks) {
      candidates.push({
        type: 'task_repeatedly_carried',
        notificationType: 'repeated_carryover',
        window: String(task.carryoverCount),
        relatedTaskId: task.id,
        title: 'A carried task needs a decision',
        body: `${task.title} has been carried ${task.carryoverCount} times.`,
        deepLink: '/backlog',
        minimumLevel: 'balanced',
      });
    }
    for (const task of dueTasks) {
      candidates.push({
        type: 'deadline_risk',
        notificationType: 'deadline_risk',
        window: `${localDate}:24h`,
        relatedTaskId: task.id,
        title: 'Deadline within 24 hours',
        body: `${task.title} is due soon.`,
        deepLink: '/backlog',
        minimumLevel: 'balanced',
      });
    }
    for (const session of openSessions) {
      if (session.status === 'waiting') {
        const waiting = session.segments.find(
          (segment) => segment.type === 'waiting' && segment.endedAt === null,
        );
        if (
          waiting &&
          (session.expectedWaitMinutes ?? 5) >= 5 &&
          now.getTime() - waiting.startedAt.getTime() >=
            this.config.waitingSuggestionMinutes * 60_000
        ) {
          candidates.push({
            type: 'current_task_waiting',
            notificationType: 'current_task_waiting',
            window: session.id,
            relatedTaskId: session.taskId,
            title: 'Use the waiting window',
            body: 'Up to three short, eligible tasks are available.',
            deepLink: '/focus',
            minimumLevel: 'proactive',
          });
        }
      }
      if (session.status === 'active' && session.task.estimateMinutes) {
        const focusedMilliseconds = session.segments
          .filter(({ type }) => type === 'focused')
          .reduce(
            (total, segment) =>
              total +
              Math.max(
                0,
                (segment.endedAt?.getTime() ?? now.getTime()) -
                  segment.startedAt.getTime(),
              ),
            0,
          );
        if (focusedMilliseconds > session.task.estimateMinutes * 60_000) {
          candidates.push({
            type: 'estimate_exceeded',
            notificationType: 'estimate_exceeded',
            window: session.id,
            relatedTaskId: session.taskId,
            title: 'Estimate reached',
            body: 'Review the next step without changing the estimate automatically.',
            deepLink: '/focus',
            minimumLevel: 'proactive',
          });
        }
      }
    }

    const activeKeys = candidates.map((candidate) =>
      triggerDedupeKey(
        candidate.type,
        userId,
        candidate.window,
        candidate.relatedTaskId,
      ),
    );
    await this.prisma.assistantTrigger.updateMany({
      where: {
        userId,
        status: 'fired',
        ...(activeKeys.length > 0 ? { dedupeKey: { notIn: activeKeys } } : {}),
      },
      data: { status: 'resolved', resolvedAt: now },
    });
    let created = 0;
    for (const candidate of candidates) {
      const didCreate = await this.createCandidate(
        userId,
        localDate,
        preferences.notificationsEnabled,
        preferences.aiInterruptionLevel,
        candidate,
      );
      if (didCreate) created += 1;
    }
    return created;
  }

  private async createCandidate(
    userId: string,
    localDate: string,
    notificationsEnabled: boolean,
    level: InterruptionLevel,
    candidate: TriggerCandidate,
  ): Promise<boolean> {
    const now = this.clock.now();
    const dedupeKey = triggerDedupeKey(
      candidate.type,
      userId,
      candidate.window,
      candidate.relatedTaskId,
    );
    const allowed =
      notificationsEnabled &&
      candidate.explicitlyEnabled !== false &&
      LEVEL_ORDER[level] >= LEVEL_ORDER[candidate.minimumLevel];
    let notificationId: string | null = null;
    try {
      await this.prisma.$transaction(async (transaction) => {
        const trigger = await transaction.assistantTrigger.create({
          data: {
            userId,
            type: candidate.type,
            status: allowed ? 'fired' : 'resolved',
            relatedTaskId: candidate.relatedTaskId ?? null,
            relatedDate: databaseDate(localDate),
            dedupeKey,
            eligibleAt: now,
            firedAt: allowed ? now : null,
            resolvedAt: allowed ? null : now,
            outcome: allowed
              ? { action: 'notification' }
              : { action: 'none', reason: 'preference_or_interruption_level' },
          },
        });
        if (allowed) {
          const notification = await this.notifications.createInTransaction(
            transaction,
            {
              userId,
              assistantTriggerId: trigger.id,
              ...(candidate.relatedTaskId
                ? { relatedTaskId: candidate.relatedTaskId }
                : {}),
              type: candidate.notificationType,
              title: candidate.title,
              body: candidate.body,
              deepLink: candidate.deepLink,
              dedupeKey,
              scheduledAt: now,
            },
          );
          notificationId = notification.id;
        }
      });
    } catch (error) {
      const existing = await this.prisma.assistantTrigger.findUnique({
        where: { userId_dedupeKey: { userId, dedupeKey } },
        select: { id: true },
      });
      if (existing) return false;
      throw error;
    }
    if (notificationId) await this.notifications.publish(notificationId);
    return true;
  }

  private minute(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return (hours ?? 0) * 60 + (minutes ?? 0);
  }
}
