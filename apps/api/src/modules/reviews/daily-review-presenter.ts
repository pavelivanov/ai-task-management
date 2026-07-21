import type { DailyReview } from '@execution/contracts';

import type { DailyReview as StoredDailyReview } from '../../generated/prisma/client';
import { formatDatabaseDate } from '../daily-plans/daily-plan-presenter';

export function toDailyReviewContract(review: StoredDailyReview): DailyReview {
  return {
    id: review.id,
    date: formatDatabaseDate(review.date),
    primaryOutcomeCompleted: review.primaryOutcomeCompleted,
    focusedMinutes: review.focusedMinutes,
    completedPlannedTasks: review.completedPlannedTasks,
    completedUnplannedTasks: review.completedUnplannedTasks,
    carriedOverTasks: review.carriedOverTasks,
    focusSessions: review.focusSessions,
    interruptionCount: review.interruptionCount,
    estimatedFocusMinutes: review.estimatedFocusMinutes,
    estimateVarianceMinutes: review.estimateVarianceMinutes,
    userReflection: review.userReflection,
    assistantSummary: review.assistantSummary,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}
