import {
  authenticatedUserSchema,
  type AuthenticatedUser,
} from '@execution/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  apiBaseUrl,
  apiCommand,
  apiRequest,
  unauthorizedEvent,
} from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';

export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.auth,
    queryFn: () => apiRequest('/auth/me', authenticatedUserSchema),
    retry: false,
  });
}

export function usePrivateCacheBoundary(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const clearPrivateCache = () =>
      queryClient.removeQueries({ queryKey: ['private'] });
    window.addEventListener(unauthorizedEvent, clearPrivateCache);
    return () =>
      window.removeEventListener(unauthorizedEvent, clearPrivateCache);
  }, [queryClient]);
}

export async function logout(): Promise<void> {
  await apiCommand('/auth/logout', { method: 'POST' });
}

export function e2eLogin(): Promise<AuthenticatedUser> {
  return apiRequest('/auth/e2e/login', authenticatedUserSchema, {
    method: 'POST',
    body: JSON.stringify({
      email: 'pilot@example.test',
      displayName: 'Pilot User',
    }),
  });
}

export function loginUrl(): string {
  return `${apiBaseUrl}/auth/google`;
}

export type { AuthenticatedUser };
