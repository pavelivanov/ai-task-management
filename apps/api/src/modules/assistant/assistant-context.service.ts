import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateAssistantSuggestion } from '@execution/contracts';
import {
  availableWorkMinutes,
  localDateForInstant,
  validateLocalDate,
} from '@execution/domain';

import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { type Clock, CLOCK } from '../auth/clock';
import { Inject } from '@nestjs/common';
import {
  databaseDate,
  formatLocalTime,
} from '../daily-plans/daily-plan-presenter';

@Injectable()
export class AssistantContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async build(
    userId: string,
    request: CreateAssistantSuggestion,
  ): Promise<Record<string, unknown>> {
    switch (request.type) {
      case 'task_extraction':
        return { sourceText: request.sourceText };
      case 'task_decomposition':
        return { task: await this.getEligibleTask(userId, request.taskId) };
      case 'carryover_diagnosis': {
        const task = await this.getEligibleTask(userId, request.taskId);
        if (
          typeof task.carryoverCount !== 'number' ||
          task.carryoverCount < this.config.carryoverDiagnosisCount
        ) {
          throw new ConflictException({
            code: 'ASSISTANT_DIAGNOSIS_NOT_ELIGIBLE',
            message: 'Carryover diagnosis is not available for this task yet.',
          });
        }
        return { task };
      }
      case 'daily_plan':
        return this.buildPlanContext(userId, request.date);
      case 'outcome_summary':
        return this.buildReviewContext(userId, request.date);
    }
  }

  private async getEligibleTask(userId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        userId,
        status: { notIn: ['completed', 'cancelled', 'archived'] },
      },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        status: true,
        priority: true,
        estimateMinutes: true,
        dueAt: true,
        carryoverCount: true,
        version: true,
      },
    });
    if (!task) {
      throw new NotFoundException({
        code: 'ASSISTANT_TASK_NOT_FOUND',
        message: 'An eligible task was not found.',
      });
    }
    return {
      ...task,
      dueAt: task.dueAt?.toISOString() ?? null,
    };
  }

  private async buildPlanContext(userId: string, requestedDate?: string) {
    const preferences = await this.prisma.userPreferences.findUnique({
      where: { userId },
      include: { user: { select: { timezone: true } } },
    });
    if (!preferences) this.throwPreferencesNotFound();
    const today = localDateForInstant(
      this.clock.now(),
      preferences.user.timezone,
    );
    const date = validateLocalDate(requestedDate ?? today);
    const plan = await this.prisma.dailyPlan.findUnique({
      where: { userId_date: { userId, date: databaseDate(date) } },
      include: {
        items: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          include: { task: true },
        },
      },
    });
    const plannedIds = plan?.items.map((item) => item.taskId) ?? [];
    const candidates = await this.prisma.task.findMany({
      where: {
        userId,
        id: { notIn: plannedIds },
        status: { in: ['backlog', 'planned', 'waiting', 'blocked'] },
      },
      orderBy: [
        { dueAt: 'asc' },
        { carryoverCount: 'desc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: 25,
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        priority: true,
        estimateMinutes: true,
        dueAt: true,
        carryoverCount: true,
        version: true,
      },
    });
    const workdayStart = formatLocalTime(preferences.workdayStart);
    const workdayEnd = formatLocalTime(preferences.workdayEnd);
    return {
      date,
      timezone: preferences.user.timezone,
      availableMinutes: availableWorkMinutes(workdayStart, workdayEnd),
      limits: {
        primary: preferences.primaryTaskLimit,
        secondary: preferences.secondaryTaskLimit,
        capacityWarningPercent: preferences.capacityWarningPercent,
      },
      planVersion: plan?.version ?? null,
      todayPlan:
        plan?.items.map((item) => ({
          taskId: item.taskId,
          taskVersion: item.task.version,
          role: item.role,
          plannedDurationMinutes: item.plannedDurationMinutes,
          title: item.task.title,
        })) ?? [],
      candidates: candidates.map((task) => ({
        ...task,
        dueAt: task.dueAt?.toISOString() ?? null,
      })),
    };
  }

  private async buildReviewContext(userId: string, date: string) {
    const validatedDate = validateLocalDate(date);
    const review = await this.prisma.dailyReview.findUnique({
      where: {
        userId_date: { userId, date: databaseDate(validatedDate) },
      },
    });
    if (!review) {
      throw new NotFoundException({
        code: 'DAILY_REVIEW_NOT_FOUND',
        message: 'Daily review was not found.',
      });
    }
    return {
      review: {
        date: validatedDate,
        primaryOutcomeCompleted: review.primaryOutcomeCompleted,
        focusedMinutes: review.focusedMinutes,
        completedPlannedTasks: review.completedPlannedTasks,
        completedUnplannedTasks: review.completedUnplannedTasks,
        carriedOverTasks: review.carriedOverTasks,
        focusSessions: review.focusSessions,
        interruptionCount: review.interruptionCount,
        userReflection: review.userReflection?.slice(0, 5_000) ?? null,
      },
    };
  }

  private throwPreferencesNotFound(): never {
    throw new NotFoundException({
      code: 'PREFERENCES_NOT_FOUND',
      message: 'User preferences were not found.',
    });
  }
}
