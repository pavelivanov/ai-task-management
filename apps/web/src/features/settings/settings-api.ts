import {
  type DeleteAccount,
  type UpdateUserPreferences,
  type UserPreferences,
  userPreferencesSchema,
} from '@execution/contracts';

import { apiCommand, apiRequest, jsonBody } from '../../lib/api-client';

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

export function deleteAccount(input: DeleteAccount): Promise<void> {
  return apiCommand('/users/me', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    ...jsonBody(input),
  });
}
