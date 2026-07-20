import type { FocusCommand } from '../features/focus/focus-api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { commandFocus, getCurrentFocus } from '../features/focus/focus-api';
import {
  formatElapsed,
  useElapsedFocusSeconds,
} from '../features/focus/use-elapsed-focus';
import { captureInbox } from '../features/inbox/inbox-api';
import { ErrorState, LoadingState } from '../features/ui/AsyncState';
import { isApiError } from '../lib/api-client';
import { queryKeys } from '../lib/query-client';
import { useAuthenticatedUser } from './use-authenticated-user';

export function FocusPage() {
  const user = useAuthenticatedUser();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState('');
  const [distraction, setDistraction] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const focus = useQuery({
    queryKey: queryKeys.focus(user.id),
    queryFn: getCurrentFocus,
  });
  const resync = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.focus(user.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.today(user.id) }),
      queryClient.invalidateQueries({
        queryKey: ['private', user.id, 'tasks'],
      }),
    ]);
  };
  const command = useMutation({
    mutationFn: ({
      command,
      body,
    }: {
      command: FocusCommand;
      body?: Record<string, unknown>;
    }) => {
      if (!focus.data) throw new Error('Focus session unavailable.');
      return commandFocus(focus.data.id, command, body);
    },
    onSuccess: async (session) => {
      queryClient.setQueryData(queryKeys.focus(user.id), session);
      setReason('');
      setOutcome('');
      setMessage(null);
      await resync();
    },
    onError: async (error) => {
      setMessage(
        isApiError(error)
          ? `${error.message} The authoritative session has been reloaded.`
          : 'The focus command could not be applied.',
      );
      await resync();
    },
  });
  const capture = useMutation({
    mutationFn: captureInbox,
    onSuccess: async () => {
      setDistraction('');
      setMessage('Distraction captured. Stay with the current work.');
      await queryClient.invalidateQueries({
        queryKey: queryKeys.inbox(user.id),
      });
    },
  });

  if (focus.isPending) return <LoadingState label="Rejoining focus…" />;
  if (focus.error)
    return (
      <ErrorState error={focus.error} retry={() => void focus.refetch()} />
    );
  if (!focus.data) {
    return (
      <div className="page focus-empty">
        <p className="eyebrow">No session running</p>
        <h1>Focus starts with a chosen commitment.</h1>
        <p className="page-intro">
          Return to Today and start the task that deserves a protected block.
        </p>
        <Link className="button button--primary" to="/today">
          Choose from Today
        </Link>
      </div>
    );
  }

  return (
    <FocusSessionView
      captureDistraction={(title) =>
        capture.mutate({ title, category: 'work', priority: 'normal' })
      }
      command={(nextCommand, body) =>
        command.mutate({
          command: nextCommand,
          ...(body ? { body } : {}),
        })
      }
      distraction={distraction}
      isPending={command.isPending || capture.isPending}
      key={`${focus.data.id}:${focus.data.serverNow}:${focus.data.version}`}
      message={message}
      outcome={outcome}
      reason={reason}
      session={focus.data}
      setDistraction={setDistraction}
      setOutcome={setOutcome}
      setReason={setReason}
    />
  );
}

function FocusSessionView({
  captureDistraction,
  command,
  distraction,
  isPending,
  message,
  outcome,
  reason,
  session,
  setDistraction,
  setOutcome,
  setReason,
}: {
  captureDistraction(title: string): void;
  command(command: FocusCommand, body?: Record<string, unknown>): void;
  distraction: string;
  isPending: boolean;
  message: string | null;
  outcome: string;
  reason: string;
  session: NonNullable<Awaited<ReturnType<typeof getCurrentFocus>>>;
  setDistraction(value: string): void;
  setOutcome(value: string): void;
  setReason(value: string): void;
}) {
  const elapsed = useElapsedFocusSeconds(session);
  const running = session.status === 'active';

  return (
    <div className="focus-page">
      <header className="focus-topline">
        <Link to="/today">← Today</Link>
        <span className={`status-pill status-pill--${session.status}`}>
          {session.status}
        </span>
      </header>
      <main className="focus-stage" aria-labelledby="focus-title">
        <p className="eyebrow">Current commitment</p>
        <h1 id="focus-title">{session.task.title}</h1>
        <p className="focus-intent">
          {session.initialIntent ?? 'Define the next concrete action.'}
        </p>
        <div
          className="timer"
          aria-label={`${elapsed} focused seconds`}
          role="timer"
        >
          {formatElapsed(elapsed)}
        </div>
        <p className="focus-started">
          Started{' '}
          {new Date(session.startedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>

        {message && (
          <p className="inline-message" role="status">
            {message}
          </p>
        )}

        <div className="focus-controls" aria-label="Focus controls">
          {running ? (
            <button
              className="button button--primary button--large"
              disabled={isPending}
              onClick={() => command('pause', reason ? { reason } : {})}
              type="button"
            >
              Pause
            </button>
          ) : (
            <button
              className="button button--primary button--large"
              disabled={isPending}
              onClick={() => command('resume')}
              type="button"
            >
              Resume
            </button>
          )}
          <button
            className="button button--quiet"
            disabled={isPending}
            onClick={() => command('wait', reason ? { reason } : {})}
            type="button"
          >
            Waiting
          </button>
          <button
            className="button button--quiet"
            disabled={isPending}
            onClick={() => command('block', reason ? { reason } : {})}
            type="button"
          >
            Blocked
          </button>
        </div>
        <label className="focus-reason">
          Context for pause, waiting, or blocked (optional)
          <input
            autoComplete="off"
            name="focusReason"
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
        </label>

        <div className="focus-finish">
          <label>
            Outcome when complete
            <input
              autoComplete="off"
              name="focusOutcome"
              onChange={(event) => setOutcome(event.target.value)}
              placeholder="What is now true? …"
              value={outcome}
            />
          </label>
          <button
            className="button"
            disabled={isPending || !outcome.trim()}
            onClick={() => command('complete', { outcome })}
            type="button"
          >
            Complete
          </button>
          <button
            className="text-button"
            disabled={isPending}
            onClick={() => command('stop', { taskStatus: 'backlog' })}
            type="button"
          >
            Stop and return to backlog
          </button>
        </div>
      </main>

      <aside
        className="distraction-capture"
        aria-labelledby="distraction-title"
      >
        <div>
          <p className="eyebrow">Protect this block</p>
          <h2 id="distraction-title">A distraction appeared</h2>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (distraction.trim()) captureDistraction(distraction);
          }}
        >
          <label className="sr-only" htmlFor="distraction">
            Capture distraction
          </label>
          <input
            autoComplete="off"
            id="distraction"
            name="distraction"
            onChange={(event) => setDistraction(event.target.value)}
            placeholder="Capture without leaving focus…"
            value={distraction}
          />
          <button disabled={!distraction.trim() || isPending} type="submit">
            Send to inbox
          </button>
        </form>
      </aside>
    </div>
  );
}
