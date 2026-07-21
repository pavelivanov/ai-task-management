import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AssistantTriggerPage,
  WaitingSuggestions,
} from '@execution/contracts';
import {
  isInsideProtectedHours,
  localDateForInstant,
  selectWaitingCandidates,
} from '@execution/domain';

import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { type Clock, CLOCK } from '../auth/clock';
import {
  formatLocalTime,
  databaseDate,
} from '../daily-plans/daily-plan-presenter';
import { toTaskContract } from '../tasks/task-presenter';
import { toAssistantTriggerContract } from './behavior-presenter';
import { Inject } from '@nestjs/common';

@Injectable()
export class BehaviorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async listTriggers(userId: string): Promise<AssistantTriggerPage> {
    const items = await this.prisma.assistantTrigger.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return { items: items.map(toAssistantTriggerContract) };
  }

  async waitingSuggestions(userId: string): Promise<WaitingSuggestions> {
    const now = this.clock.now();
    const session = await this.prisma.focusSession.findFirst({
      where: { userId, status: 'waiting' },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      include: {
        segments: {
          where: { type: 'waiting', endedAt: null },
          orderBy: { sequence: 'desc' },
          take: 1,
        },
      },
    });
    const waitingSegment = session?.segments[0];
    const expectedWaitMinutes = session?.expectedWaitMinutes ?? 5;
    if (
      !session ||
      !waitingSegment ||
      expectedWaitMinutes < 5 ||
      now.getTime() - waitingSegment.startedAt.getTime() <
        this.config.waitingSuggestionMinutes * 60_000
    ) {
      this.throwUnavailable();
    }
    const active = await this.prisma.focusSession.findFirst({
      where: { userId, status: 'active' },
      select: { id: true },
    });
    if (active) this.throwUnavailable();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { preferences: true },
    });
    if (!user?.preferences) this.throwUnavailable();
    const localDate = localDateForInstant(now, user.timezone);
    const tasks = await this.prisma.task.findMany({
      where: {
        userId,
        id: { not: session.taskId },
        status: { in: ['backlog', 'planned'] },
      },
      include: {
        dailyPlanItems: {
          where: {
            role: 'optional',
            dailyPlan: { userId, date: databaseDate(localDate) },
          },
          select: { id: true },
        },
      },
      take: 100,
    });
    const protectedNow = isInsideProtectedHours({
      now,
      timeZone: user.timezone,
      enabled: user.preferences.protectedHoursEnabled,
      start: user.preferences.protectedHoursStart
        ? formatLocalTime(user.preferences.protectedHoursStart)
        : null,
      end: user.preferences.protectedHoursEnd
        ? formatLocalTime(user.preferences.protectedHoursEnd)
        : null,
    });
    const selected = selectWaitingCandidates(
      tasks.map((task) => ({
        ...task,
        optionalPlanItem: task.dailyPlanItems.length > 0,
      })),
      expectedWaitMinutes,
      protectedNow,
    );
    return {
      waitingSessionId: session.id,
      expectedWaitMinutes,
      eligibleSince: waitingSegment.startedAt.toISOString(),
      explanation: null,
      tasks: selected.map(toTaskContract),
    };
  }

  private throwUnavailable(): never {
    throw new NotFoundException({
      code: 'WAITING_SUGGESTIONS_UNAVAILABLE',
      message: 'No eligible waiting-task suggestions are available.',
    });
  }
}
