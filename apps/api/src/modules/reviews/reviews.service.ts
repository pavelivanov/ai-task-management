import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DailyReview, UpdateDailyReview } from '@execution/contracts';
import {
  localDateBoundsUtc,
  overlapDurationMilliseconds,
  validateLocalDate,
} from '@execution/domain';

import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { type Clock, CLOCK } from '../auth/clock';
import { databaseDate } from '../daily-plans/daily-plan-presenter';
import { toDailyReviewContract } from './daily-review-presenter';

type Transaction = Prisma.TransactionClient;

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(userId: string, date: string): Promise<DailyReview> {
    const validatedDate = validateLocalDate(date);
    const review = await this.prisma.dailyReview.findUnique({
      where: {
        userId_date: { userId, date: databaseDate(validatedDate) },
      },
    });
    if (!review) this.throwNotFound();
    return toDailyReviewContract(review);
  }

  async generate(userId: string, date: string): Promise<DailyReview> {
    const review = await this.prisma.$transaction((transaction) =>
      this.generateInTransaction(transaction, userId, date),
    );
    return toDailyReviewContract(review);
  }

  async generateInTransaction(
    transaction: Transaction,
    userId: string,
    date: string,
  ) {
    const validatedDate = validateLocalDate(date);
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    if (!user) this.throwNotFound();

    const { start, end } = localDateBoundsUtc(validatedDate, user.timezone);
    const [
      plan,
      completionEvents,
      carryoverEvents,
      interruptionEvents,
      captureEvents,
    ] = await Promise.all([
      transaction.dailyPlan.findUnique({
        where: {
          userId_date: { userId, date: databaseDate(validatedDate) },
        },
        select: {
          items: { select: { taskId: true, role: true } },
        },
      }),
      transaction.taskEvent.findMany({
        where: {
          userId,
          type: 'completed',
          createdAt: { gte: start, lt: end },
        },
        select: { taskId: true },
      }),
      transaction.taskEvent.findMany({
        where: {
          userId,
          type: 'carried_over',
          createdAt: { gte: start, lt: end },
        },
        select: { taskId: true, metadata: true },
      }),
      transaction.taskEvent.findMany({
        where: {
          userId,
          type: { in: ['paused', 'waiting', 'blocked'] },
          createdAt: { gte: start, lt: end },
        },
        select: { id: true },
      }),
      transaction.taskEvent.findMany({
        where: {
          userId,
          type: 'created',
          createdAt: { gte: start, lt: end },
        },
        select: { metadata: true },
      }),
    ]);

    const completedTaskIds = new Set(
      completionEvents.map((event) => event.taskId),
    );
    const plannedTaskIds = new Set(
      plan?.items.map((item) => item.taskId) ?? [],
    );
    const primaryTaskIds = new Set(
      plan?.items
        .filter((item) => item.role === 'primary')
        .map((item) => item.taskId) ?? [],
    );
    const completedPlannedTasks = [...completedTaskIds].filter((taskId) =>
      plannedTaskIds.has(taskId),
    ).length;
    const completedUnplannedTasks =
      completedTaskIds.size - completedPlannedTasks;
    const carriedOverTaskIds = new Set(
      carryoverEvents
        .filter((event) =>
          this.hasSourcePlanDate(event.metadata, validatedDate),
        )
        .map((event) => event.taskId),
    );

    const effectiveEnd = new Date(
      Math.min(end.getTime(), this.clock.now().getTime()),
    );
    const focusedSegments =
      effectiveEnd > start
        ? await transaction.focusSessionSegment.findMany({
            where: {
              type: 'focused',
              startedAt: { lt: effectiveEnd },
              OR: [{ endedAt: null }, { endedAt: { gt: start } }],
              focusSession: { userId },
            },
            select: {
              focusSessionId: true,
              startedAt: true,
              endedAt: true,
              focusSession: {
                select: {
                  taskId: true,
                  task: { select: { estimateMinutes: true } },
                },
              },
            },
          })
        : [];
    const focusedMilliseconds = focusedSegments.reduce(
      (total, segment) =>
        total +
        overlapDurationMilliseconds(
          segment.startedAt,
          new Date(
            Math.min(
              segment.endedAt?.getTime() ?? effectiveEnd.getTime(),
              effectiveEnd.getTime(),
            ),
          ),
          start,
          end,
        ),
      0,
    );
    const focusSessionIds = new Set(
      focusedSegments.map((segment) => segment.focusSessionId),
    );
    const estimateByTaskId = new Map<string, number>();
    for (const segment of focusedSegments) {
      const estimate = segment.focusSession.task.estimateMinutes;
      if (estimate !== null) {
        estimateByTaskId.set(segment.focusSession.taskId, estimate);
      }
    }
    const estimatedFocusMinutes = [...estimateByTaskId.values()].reduce(
      (total, estimate) => total + estimate,
      0,
    );
    const focusedMinutes = Math.floor(focusedMilliseconds / 60_000);
    const distractionCount = captureEvents.filter((event) =>
      this.hasMetadataSource(event.metadata, 'focus_distraction'),
    ).length;

    return transaction.dailyReview.upsert({
      where: {
        userId_date: { userId, date: databaseDate(validatedDate) },
      },
      create: {
        userId,
        date: databaseDate(validatedDate),
        primaryOutcomeCompleted: [...primaryTaskIds].some((taskId) =>
          completedTaskIds.has(taskId),
        ),
        focusedMinutes,
        completedPlannedTasks,
        completedUnplannedTasks,
        carriedOverTasks: carriedOverTaskIds.size,
        focusSessions: focusSessionIds.size,
        interruptionCount: interruptionEvents.length + distractionCount,
        estimatedFocusMinutes,
        estimateVarianceMinutes: focusedMinutes - estimatedFocusMinutes,
      },
      update: {
        primaryOutcomeCompleted: [...primaryTaskIds].some((taskId) =>
          completedTaskIds.has(taskId),
        ),
        focusedMinutes,
        completedPlannedTasks,
        completedUnplannedTasks,
        carriedOverTasks: carriedOverTaskIds.size,
        focusSessions: focusSessionIds.size,
        interruptionCount: interruptionEvents.length + distractionCount,
        estimatedFocusMinutes,
        estimateVarianceMinutes: focusedMinutes - estimatedFocusMinutes,
      },
    });
  }

  async update(
    userId: string,
    date: string,
    input: UpdateDailyReview,
  ): Promise<DailyReview> {
    const validatedDate = validateLocalDate(date);
    const updated = await this.prisma.dailyReview.updateMany({
      where: { userId, date: databaseDate(validatedDate) },
      data: { userReflection: input.userReflection },
    });
    if (updated.count !== 1) this.throwNotFound();
    return this.get(userId, validatedDate);
  }

  async setAssistantSummaryInTransaction(
    transaction: Transaction,
    userId: string,
    date: string,
    summary: string,
  ): Promise<void> {
    const validatedDate = validateLocalDate(date);
    const updated = await transaction.dailyReview.updateMany({
      where: { userId, date: databaseDate(validatedDate) },
      data: { assistantSummary: summary },
    });
    if (updated.count !== 1) this.throwNotFound();
  }

  private hasSourcePlanDate(metadata: Prisma.JsonValue, date: string): boolean {
    return (
      typeof metadata === 'object' &&
      metadata !== null &&
      !Array.isArray(metadata) &&
      metadata.sourcePlanDate === date
    );
  }

  private hasMetadataSource(
    metadata: Prisma.JsonValue,
    source: string,
  ): boolean {
    return (
      typeof metadata === 'object' &&
      metadata !== null &&
      !Array.isArray(metadata) &&
      metadata.source === source
    );
  }

  private throwNotFound(): never {
    throw new NotFoundException({
      code: 'DAILY_REVIEW_NOT_FOUND',
      message: 'Daily review was not found.',
    });
  }
}
