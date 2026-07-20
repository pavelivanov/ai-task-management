import { ConflictException, Injectable } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client';

export const DAILY_PLAN_CLOSE_GUARD = Symbol('DAILY_PLAN_CLOSE_GUARD');

export interface DailyPlanCloseGuard {
  assertCanClose(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void>;
}

@Injectable()
export class ActiveFocusSessionCloseGuard implements DailyPlanCloseGuard {
  async assertCanClose(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const current = await transaction.focusSession.findFirst({
      where: { userId, status: 'active' },
      select: {
        id: true,
        taskId: true,
        status: true,
        version: true,
        startedAt: true,
      },
    });
    if (!current) return;
    throw new ConflictException({
      code: 'ACTIVE_FOCUS_SESSION_EXISTS',
      message: 'Pause or stop the active focus session before closing the day.',
      currentSession: {
        ...current,
        startedAt: current.startedAt.toISOString(),
      },
    });
  }
}
