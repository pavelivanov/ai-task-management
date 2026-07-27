import type { FocusCommand } from '../features/focus/focus-api';
import type { Task } from '@execution/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import {
  captureFocusDistraction,
  commandFocus,
  getCurrentFocus,
  switchWaitingFocus,
} from '../features/focus/focus-api';
import { getWaitingSuggestions } from '../features/behavior/behavior-api';
import {
  formatElapsed,
  useElapsedFocusSeconds,
} from '../features/focus/use-elapsed-focus';
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
  const [expectedWaitMinutes, setExpectedWaitMinutes] = useState(15);
  const [message, setMessage] = useState<string | null>(null);
  const focus = useQuery({
    queryKey: queryKeys.focus(user.id),
    queryFn: getCurrentFocus,
  });
  const waitingSuggestions = useQuery({
    queryKey: queryKeys.waitingSuggestions(
      user.id,
      focus.data?.id ?? 'unavailable',
    ),
    queryFn: getWaitingSuggestions,
    enabled: focus.data?.status === 'waiting',
    retry: false,
    refetchInterval: focus.data?.status === 'waiting' ? 15_000 : false,
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
    mutationFn: (title: string) => {
      if (!focus.data) throw new Error('Focus session unavailable.');
      return captureFocusDistraction(focus.data.id, title);
    },
    onSuccess: async () => {
      setDistraction('');
      setMessage('Distraction captured. Stay with the current work.');
      await queryClient.invalidateQueries({
        queryKey: queryKeys.inbox(user.id),
      });
    },
  });
  const startWaitingTask = useMutation({
    mutationFn: (task: Task) => {
      if (!focus.data) throw new Error('Focus session unavailable.');
      return switchWaitingFocus(focus.data.id, {
        taskId: task.id,
        initialIntent: task.description ?? task.title,
      });
    },
    onSuccess: async (session) => {
      queryClient.setQueryData(queryKeys.focus(user.id), session);
      setMessage('Short task started. The waiting task remains waiting.');
      await resync();
    },
    onError: async (error) => {
      setMessage(
        isApiError(error) ? error.message : 'The short task could not start.',
      );
      await resync();
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
    <>
      <FocusSessionView
        captureDistraction={(title) => capture.mutate(title)}
        command={(nextCommand, body) =>
          command.mutate({
            command: nextCommand,
            ...(body ? { body } : {}),
          })
        }
        distraction={distraction}
        expectedWaitMinutes={expectedWaitMinutes}
        isPending={command.isPending || capture.isPending}
        key={`${focus.data.id}:${focus.data.serverNow}:${focus.data.version}`}
        message={message}
        outcome={outcome}
        reason={reason}
        session={focus.data}
        setDistraction={setDistraction}
        setExpectedWaitMinutes={setExpectedWaitMinutes}
        setOutcome={setOutcome}
        setReason={setReason}
      />
      {focus.data.status === 'waiting' && waitingSuggestions.data && (
        <WaitingSuggestionsPanel
          pending={startWaitingTask.isPending}
          start={(task) => startWaitingTask.mutate(task)}
          tasks={waitingSuggestions.data.tasks}
          waitMinutes={waitingSuggestions.data.expectedWaitMinutes}
        />
      )}
    </>
  );
}

function FocusSessionView({
  captureDistraction,
  command,
  distraction,
  expectedWaitMinutes,
  isPending,
  message,
  outcome,
  reason,
  session,
  setDistraction,
  setExpectedWaitMinutes,
  setOutcome,
  setReason,
}: {
  captureDistraction(title: string): void;
  command(command: FocusCommand, body?: Record<string, unknown>): void;
  distraction: string;
  expectedWaitMinutes: number;
  isPending: boolean;
  message: string | null;
  outcome: string;
  reason: string;
  session: NonNullable<Awaited<ReturnType<typeof getCurrentFocus>>>;
  setDistraction(value: string): void;
  setExpectedWaitMinutes(value: number): void;
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
            onClick={() =>
              command('wait', {
                ...(reason ? { reason } : {}),
                expectedWaitMinutes,
              })
            }
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
        <label className="focus-reason">
          Expected wait (minutes)
          <input
            max={1440}
            min={5}
            name="expectedWaitMinutes"
            onChange={(event) =>
              setExpectedWaitMinutes(Math.max(5, Number(event.target.value)))
            }
            type="number"
            value={expectedWaitMinutes}
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

function WaitingSuggestionsPanel({
  pending,
  start,
  tasks,
  waitMinutes,
}: {
  pending: boolean;
  start(task: Task): void;
  tasks: Task[];
  waitMinutes: number;
}) {
  return (
    <aside
      className="waiting-suggestions"
      aria-labelledby="waiting-suggestions-title"
    >
      <div>
        <p className="eyebrow">Expected wait · {waitMinutes} min</p>
        <h2 id="waiting-suggestions-title">Short work that fits</h2>
        <p>
          The list is deterministic, capped at three, and excludes personal work
          during protected hours.
        </p>
      </div>
      {tasks.length === 0 ? (
        <p className="empty-note">No eligible short tasks fit this wait.</p>
      ) : (
        <ul className="waiting-candidate-list">
          {tasks.map((task) => (
            <li key={task.id}>
              <span>
                <strong>{task.title}</strong>
                <small>
                  {task.estimateMinutes} min · {task.priority}
                </small>
              </span>
              <button
                className="button button--quiet"
                disabled={pending}
                onClick={() => start(task)}
                type="button"
              >
                Start this
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
