import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client';

export const DAILY_PLAN_CLOSE_GUARD = Symbol('DAILY_PLAN_CLOSE_GUARD');

export interface DailyPlanCloseGuard {
  assertCanClose(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void>;
}

@Injectable()
export class NoActiveFocusSessionCloseGuard implements DailyPlanCloseGuard {
  assertCanClose(): Promise<void> {
    return Promise.resolve();
  }
}
