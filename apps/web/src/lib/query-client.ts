import { QueryClient } from '@tanstack/react-query';

export function createExecutionQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          !(
            typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            error.status === 401
          ) && failureCount < 1,
        staleTime: 15_000,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

export const queryKeys = {
  auth: ['auth', 'me'] as const,
  today: (userId: string) => ['private', userId, 'today'] as const,
  focus: (userId: string) => ['private', userId, 'focus'] as const,
  inbox: (userId: string) => ['private', userId, 'inbox'] as const,
  tasks: (userId: string, filters: string) =>
    ['private', userId, 'tasks', filters] as const,
  projects: (userId: string) => ['private', userId, 'projects'] as const,
  preferences: (userId: string) => ['private', userId, 'preferences'] as const,
  review: (userId: string, date: string) =>
    ['private', userId, 'review', date] as const,
};
