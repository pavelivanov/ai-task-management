import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { apiBaseUrl } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';

export function RealtimeSync({ userId }: { userId: string }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const events = new EventSource(`${apiBaseUrl}/events`, {
      withCredentials: true,
    });
    const refetchCurrent = () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.focus(userId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.today(userId) }),
      ]);
    };
    const onFocus = () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.focus(userId),
      });
    };
    const onPlan = () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.today(userId) }),
        queryClient.invalidateQueries({
          queryKey: ['private', userId, 'tasks'],
        }),
      ]);
    };
    const onSuggestion = () => {
      void queryClient.invalidateQueries({
        queryKey: ['private', userId, 'assistant'],
      });
    };

    events.onopen = refetchCurrent;
    events.addEventListener('focus.changed', onFocus);
    events.addEventListener('plan.changed', onPlan);
    events.addEventListener('suggestion.changed', onSuggestion);
    window.addEventListener('online', refetchCurrent);
    return () => {
      window.removeEventListener('online', refetchCurrent);
      events.removeEventListener('focus.changed', onFocus);
      events.removeEventListener('plan.changed', onPlan);
      events.removeEventListener('suggestion.changed', onSuggestion);
      events.close();
    };
  }, [queryClient, userId]);

  return null;
}
