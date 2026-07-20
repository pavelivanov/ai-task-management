import type { ProcessInboxTask, Task } from '@execution/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  captureInbox,
  listInbox,
  processInbox,
} from '../features/inbox/inbox-api';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../features/ui/AsyncState';
import { isApiError } from '../lib/api-client';
import { queryKeys } from '../lib/query-client';
import { useAuthenticatedUser } from './use-authenticated-user';

export function InboxPage() {
  const user = useAuthenticatedUser();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [estimateMinutes, setEstimateMinutes] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const inbox = useQuery({
    queryKey: queryKeys.inbox(user.id),
    queryFn: () => listInbox(),
  });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox(user.id) }),
      queryClient.invalidateQueries({
        queryKey: ['private', user.id, 'tasks'],
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.today(user.id) }),
    ]);
  };
  const capture = useMutation({
    mutationFn: captureInbox,
    onSuccess: async () => {
      setTitle('');
      setEstimateMinutes('');
      setActionError(null);
      await invalidate();
    },
    onError: (error) =>
      setActionError(
        isApiError(error) ? error.message : 'Capture could not be saved.',
      ),
  });
  const process = useMutation({
    mutationFn: ({ task, input }: { task: Task; input: ProcessInboxTask }) =>
      processInbox(task.id, input),
    onSuccess: invalidate,
    onError: (error) =>
      setActionError(
        isApiError(error) ? error.message : 'The inbox item changed.',
      ),
  });

  return (
    <div className="page page--queue">
      <header className="page-header">
        <div>
          <p className="eyebrow">Capture now, decide once</p>
          <h1>Inbox</h1>
          <p className="page-intro">
            A temporary landing place. Process each item into a real commitment
            or let it go.
          </p>
        </div>
        <span className="count-badge">
          {inbox.data?.items.length ?? '—'} open
        </span>
      </header>

      <form
        className="capture-bar"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim())
            capture.mutate({
              title,
              category: 'work',
              priority: 'normal',
              ...(estimateMinutes
                ? { estimateMinutes: Number(estimateMinutes) }
                : {}),
            });
        }}
      >
        <label htmlFor="inbox-capture">Quick capture</label>
        <div>
          <input
            autoComplete="off"
            id="inbox-capture"
            maxLength={240}
            onChange={(event) => setTitle(event.target.value)}
            name="inboxCapture"
            placeholder="What just arrived? …"
            value={title}
          />
          <label className="estimate-field" htmlFor="inbox-estimate">
            <span className="sr-only">Estimate minutes</span>
            <input
              autoComplete="off"
              id="inbox-estimate"
              max={10_080}
              min={1}
              onChange={(event) => setEstimateMinutes(event.target.value)}
              name="estimateMinutes"
              placeholder="Minutes…"
              type="number"
              value={estimateMinutes}
            />
          </label>
          <button
            className="button button--primary"
            disabled={!title.trim() || capture.isPending}
            type="submit"
          >
            Capture
          </button>
        </div>
      </form>
      {actionError && (
        <p className="error-message" role="alert">
          {actionError}
        </p>
      )}

      {inbox.isPending && <LoadingState label="Opening the inbox…" />}
      {inbox.error && (
        <ErrorState error={inbox.error} retry={() => void inbox.refetch()} />
      )}
      {inbox.data?.items.length === 0 && (
        <EmptyState title="Nothing waiting for a decision.">
          Capture interruptions here without breaking your current focus.
        </EmptyState>
      )}
      {inbox.data && inbox.data.items.length > 0 && (
        <ul className="task-list" aria-label="Inbox items">
          {inbox.data.items.map((task) => (
            <li className="task-row" key={task.id}>
              <div className="task-copy">
                <span
                  className={`priority-dot priority-dot--${task.priority}`}
                />
                <span>
                  <strong>{task.title}</strong>
                  <small>
                    {task.category} · {task.estimateMinutes ?? 'unestimated'}
                    {task.estimateMinutes ? ' min' : ''}
                  </small>
                </span>
              </div>
              <div className="row-actions" aria-label={`Process ${task.title}`}>
                <button
                  className="button button--small"
                  disabled={process.isPending}
                  onClick={() =>
                    process.mutate({ task, input: { action: 'accept' } })
                  }
                  type="button"
                >
                  Backlog
                </button>
                <button
                  className="button button--small button--primary"
                  disabled={process.isPending}
                  onClick={() =>
                    process.mutate({
                      task,
                      input: { action: 'schedule', role: 'optional' },
                    })
                  }
                  type="button"
                >
                  Today
                </button>
                <details className="more-menu">
                  <summary aria-label={`More actions for ${task.title}`}>
                    •••
                  </summary>
                  <div>
                    {(['archive', 'cancel', 'delete'] as const).map(
                      (action) => (
                        <button
                          disabled={process.isPending}
                          key={action}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `${action[0]?.toUpperCase()}${action.slice(1)} “${task.title}”?`,
                              )
                            )
                              return;
                            process.mutate({ task, input: { action } });
                          }}
                          type="button"
                        >
                          {action[0]?.toUpperCase()}
                          {action.slice(1)}
                        </button>
                      ),
                    )}
                  </div>
                </details>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
