import { type DailyReview, dailyReviewSchema } from '@execution/contracts';

import { apiRequest, jsonBody } from '../../lib/api-client';

export function getDailyReview(date: string): Promise<DailyReview> {
  return apiRequest(`/reviews/daily/${date}`, dailyReviewSchema);
}

export function generateDailyReview(date: string): Promise<DailyReview> {
  return apiRequest(`/reviews/daily/${date}/generate`, dailyReviewSchema, {
    method: 'POST',
  });
}

export function saveReflection(
  date: string,
  userReflection: string | null,
): Promise<DailyReview> {
  return apiRequest(`/reviews/daily/${date}`, dailyReviewSchema, {
    method: 'PATCH',
    ...jsonBody({ userReflection }),
  });
}
