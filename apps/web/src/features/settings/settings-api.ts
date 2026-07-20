import {
  type UpdateUserPreferences,
  type UserPreferences,
  userPreferencesSchema,
} from '@execution/contracts';

import { apiRequest, jsonBody } from '../../lib/api-client';

export function getPreferences(): Promise<UserPreferences> {
  return apiRequest('/users/me/preferences', userPreferencesSchema);
}

export function updatePreferences(
  input: UpdateUserPreferences,
): Promise<UserPreferences> {
  return apiRequest('/users/me/preferences', userPreferencesSchema, {
    method: 'PATCH',
    ...jsonBody(input),
  });
}
