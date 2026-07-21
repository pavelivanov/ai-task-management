import type {
  AssistantSuggestion,
  DailyPlanItem,
  DailyPlanRole,
  PlanningWarning,
  Task,
} from '@execution/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  addPlanItem,
  closeTodayPlan,
  createTodayPlan,
  getTodayPlan,
  movePlanItem,
} from '../features/daily-plan/daily-plan-api';
import { AssistantSuggestionCard } from '../features/assistant/AssistantSuggestionCard';
import { createAssistantSuggestion } from '../features/assistant/assistant-api';
import { startFocus } from '../features/focus/focus-api';
import { captureInbox } from '../features/inbox/inbox-api';
import { listTasks, taskFiltersKey } from '../features/tasks/task-api';
import { ErrorState, LoadingState } from '../features/ui/AsyncState';
import { useUiStore } from '../features/ui/ui-store';
import { isApiError } from '../lib/api-client';
import { formatMinutes } from '../lib/date';
import { queryKeys } from '../lib/query-client';
import { useAuthenticatedUser } from './use-authenticated-user';

function warningText(warning: PlanningWarning): string {
  switch (warning.code) {
    case 'MULTIPLE_PRIMARY':
      return `Choose one primary outcome; ${warning.data.count} are selected.`;
    case 'TOO_MANY_SECONDARY':
      return `Keep secondary work to ${warning.data.limit}; ${warning.data.count} are selected.`;
    case 'MISSING_ESTIMATE':
      return `${warning.data.taskIds.length} planned task${warning.data.taskIds.length === 1 ? '' : 's'} need an estimate.`;
    case 'OVER_CAPACITY':
      return `${formatMinutes(warning.data.scheduledMinutes)} is planned inside ${formatMinutes(warning.data.availableMinutes)} of available time.`;
  }
}

function roleLabel(role: DailyPlanRole): string {
  return role === 'primary'
    ? 'Primary outcome'
    : role === 'secondary'
      ? 'Secondary commitments'
      : 'Optional queue';
}

export function TodayPage() {
  const user = useAuthenticatedUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const addToPlanOpen = useUiStore((state) => state.addToPlanOpen);
  const setAddToPlanOpen = useUiStore((state) => state.setAddToPlanOpen);
  const [captureTitle, setCaptureTitle] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<AssistantSuggestion | null>(
    null,
  );
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!addToPlanOpen) return;
    dialogRef.current
      ?.querySelector<HTMLElement>('[data-dialog-close]')
      ?.focus();
  }, [addToPlanOpen]);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      setAddToPlanOpen(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
      ) ?? []),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const today = useQuery({
    queryKey: queryKeys.today(user.id),
    queryFn: getTodayPlan,
    retry: false,
  });
  const backlogFilters = { status: 'backlog' as const, limit: 8 };
  const backlog = useQuery({
    queryKey: queryKeys.tasks(user.id, taskFiltersKey(backlogFilters)),
    queryFn: () => listTasks(backlogFilters),
    enabled: addToPlanOpen,
  });
  const refreshPlanAndTasks = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.today(user.id) }),
      queryClient.invalidateQueries({
        queryKey: ['private', user.id, 'tasks'],
      }),
    ]);
  };
  const create = useMutation({
    mutationFn: createTodayPlan,
    onSuccess: (plan) =>
      queryClient.setQueryData(queryKeys.today(user.id), plan),
  });
  const capture = useMutation({
    mutationFn: captureInbox,
    onSuccess: async () => {
      setCaptureTitle('');
      setMessage('Captured to the inbox. Today stayed unchanged.');
      await queryClient.invalidateQueries({
        queryKey: queryKeys.inbox(user.id),
      });
    },
  });
  const add = useMutation({
    mutationFn: ({ task, role }: { task: Task; role: DailyPlanRole }) => {
      if (!today.data) throw new Error('Create today before adding work.');
      return addPlanItem({
        taskId: task.id,
        role,
        expectedPlanVersion: today.data.version,
        ...(task.estimateMinutes
          ? { plannedDurationMinutes: task.estimateMinutes }
          : {}),
      });
    },
    onSuccess: async (plan) => {
      queryClient.setQueryData(queryKeys.today(user.id), plan);
      setMessage('Commitment added.');
      await refreshPlanAndTasks();
    },
    onError: async (error) => {
      setMessage(
        isApiError(error)
          ? error.message
          : 'The plan changed. Refreshing it now.',
      );
      await refreshPlanAndTasks();
    },
  });
  const move = useMutation({
    mutationFn: ({
      item,
      position,
    }: {
      item: DailyPlanItem;
      position: number;
    }) => {
      if (!today.data) throw new Error('Plan unavailable.');
      return movePlanItem(item.id, today.data.version, position);
    },
    onSuccess: (plan) =>
      queryClient.setQueryData(queryKeys.today(user.id), plan),
    onError: async (error) => {
      setMessage(
        isApiError(error) ? error.message : 'Ordering changed elsewhere.',
      );
      await refreshPlanAndTasks();
    },
  });
  const focus = useMutation({
    mutationFn: (item: DailyPlanItem) =>
      startFocus({
        taskId: item.taskId,
        initialIntent: item.task.description ?? item.task.title,
      }),
    onSuccess: async (session) => {
      queryClient.setQueryData(queryKeys.focus(user.id), session);
      await refreshPlanAndTasks();
      navigate('/focus');
    },
    onError: (error) =>
      setMessage(isApiError(error) ? error.message : 'Focus could not start.'),
  });
  const close = useMutation({
    mutationFn: () => {
      if (!today.data) throw new Error('Plan unavailable.');
      return closeTodayPlan(today.data.version);
    },
    onSuccess: async (plan) => {
      queryClient.setQueryData(queryKeys.today(user.id), plan);
      await refreshPlanAndTasks();
    },
    onError: (error) =>
      setMessage(
        isApiError(error) ? error.message : 'The day could not close.',
      ),
  });
  const suggestPlan = useMutation({
    mutationFn: () => {
      if (!today.data) throw new Error('Plan unavailable.');
      return createAssistantSuggestion({
        type: 'daily_plan',
        date: today.data.date,
      });
    },
    onSuccess: (result) => {
      setSuggestion(result);
      setMessage(null);
    },
    onError: (error) =>
      setMessage(
        isApiError(error)
          ? error.message
          : 'A plan proposal could not be prepared.',
      ),
  });

  const notFound = isApiError(today.error) && today.error.status === 404;
  if (today.isPending) return <LoadingState label="Composing today…" />;
  if (today.error && !notFound) {
    return (
      <ErrorState error={today.error} retry={() => void today.refetch()} />
    );
  }
  if (notFound || !today.data) {
    return (
      <div className="page today-empty">
        <p className="eyebrow">Begin with a boundary</p>
        <h1>What would make today count?</h1>
        <p className="page-intro">
          Create a blank day, then choose one primary outcome. Nothing is pulled
          from your backlog automatically.
        </p>
        <button
          className="button button--primary button--large"
          disabled={create.isPending}
          onClick={() => create.mutate()}
          type="button"
        >
          Create today’s plan
        </button>
      </div>
    );
  }

  const plan = today.data;
  const groups = (['primary', 'secondary', 'optional'] as const).map(
    (role) => ({
      role,
      items: plan.items.filter((item) => item.role === role),
    }),
  );

  return (
    <div className="page today-page">
      <header className="today-header">
        <div>
          <p className="eyebrow">{plan.date}</p>
          <h1>Today</h1>
          <p className="page-intro">
            {plan.workdayStart}–{plan.workdayEnd} ·{' '}
            {formatMinutes(plan.capacity.scheduledMinutes)} of{' '}
            {formatMinutes(plan.capacity.availableMinutes)} committed
          </p>
        </div>
        <div className="header-actions">
          {plan.status !== 'closed' && (
            <>
              <button
                className="button"
                disabled={suggestPlan.isPending}
                onClick={() => suggestPlan.mutate()}
                type="button"
              >
                Suggest plan
              </button>
              <button
                className="button button--primary"
                onClick={() => setAddToPlanOpen(true)}
                type="button"
              >
                Add commitment
              </button>
            </>
          )}
          <span className={`status-pill status-pill--${plan.status}`}>
            {plan.status}
          </span>
        </div>
      </header>

      {suggestion && (
        <AssistantSuggestionCard
          initial={suggestion}
          onApplied={async () => {
            setSuggestion(null);
            await refreshPlanAndTasks();
          }}
          userId={user.id}
        />
      )}

      {plan.warnings.length > 0 && (
        <section className="warning-strip" aria-labelledby="plan-warnings">
          <h2 id="plan-warnings">Plan needs a decision</h2>
          <ul>
            {plan.warnings.map((warning) => (
              <li key={warning.code}>{warningText(warning)}</li>
            ))}
          </ul>
        </section>
      )}
      {message && (
        <p className="inline-message" role="status">
          {message}
        </p>
      )}

      <div className="commitment-stack">
        {groups.map(({ role, items }) => (
          <section
            className={`commitment-group commitment-group--${role}`}
            key={role}
            aria-labelledby={`${role}-title`}
          >
            <header>
              <h2 id={`${role}-title`}>{roleLabel(role)}</h2>
              <span>{items.length}</span>
            </header>
            {items.length === 0 ? (
              <button
                className="empty-slot"
                disabled={plan.status === 'closed'}
                onClick={() => setAddToPlanOpen(true)}
                type="button"
              >
                {role === 'primary'
                  ? 'Choose the outcome worth protecting'
                  : 'Leave clear or add deliberately'}
              </button>
            ) : (
              <ol className="commitment-list">
                {items.map((item) => (
                  <li
                    draggable={plan.status !== 'closed'}
                    key={item.id}
                    onDragEnd={() => setDraggingItemId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDragStart={() => setDraggingItemId(item.id)}
                    onDrop={() => {
                      const dragged = plan.items.find(
                        (candidate) => candidate.id === draggingItemId,
                      );
                      if (dragged && dragged.id !== item.id) {
                        move.mutate({ item: dragged, position: item.position });
                      }
                      setDraggingItemId(null);
                    }}
                  >
                    <div>
                      <span className="task-kicker">
                        {item.task.category} ·{' '}
                        {item.plannedDurationMinutes ??
                          item.task.estimateMinutes ??
                          '—'}{' '}
                        min
                      </span>
                      <h3>{item.task.title}</h3>
                      {item.task.description && <p>{item.task.description}</p>}
                    </div>
                    <div className="commitment-actions">
                      {!['completed', 'cancelled', 'archived'].includes(
                        item.task.status,
                      ) &&
                        plan.status !== 'closed' && (
                          <button
                            className="button button--primary"
                            disabled={focus.isPending}
                            onClick={() => focus.mutate(item)}
                            type="button"
                          >
                            Start
                          </button>
                        )}
                      {plan.status !== 'closed' && (
                        <div
                          className="reorder-actions"
                          aria-label={`Reorder ${item.task.title}`}
                        >
                          <button
                            aria-label={`Move ${item.task.title} up`}
                            disabled={item.position === 0 || move.isPending}
                            onClick={() =>
                              move.mutate({ item, position: item.position - 1 })
                            }
                            type="button"
                          >
                            ↑
                          </button>
                          <button
                            aria-label={`Move ${item.task.title} down`}
                            disabled={
                              item.position === plan.items.length - 1 ||
                              move.isPending
                            }
                            onClick={() =>
                              move.mutate({ item, position: item.position + 1 })
                            }
                            type="button"
                          >
                            ↓
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>

      <section className="quick-capture" aria-labelledby="today-capture-title">
        <div>
          <p className="eyebrow">Do not renegotiate the plan</p>
          <h2 id="today-capture-title">Something else arrived?</h2>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (captureTitle.trim())
              capture.mutate({
                title: captureTitle,
                category: 'work',
                priority: 'normal',
              });
          }}
        >
          <label className="sr-only" htmlFor="today-capture">
            Capture to inbox
          </label>
          <input
            autoComplete="off"
            id="today-capture"
            name="todayCapture"
            onChange={(event) => setCaptureTitle(event.target.value)}
            placeholder="Send it to inbox…"
            value={captureTitle}
          />
          <button
            disabled={!captureTitle.trim() || capture.isPending}
            type="submit"
          >
            Capture
          </button>
        </form>
      </section>

      <footer className="day-footer">
        {plan.status === 'closed' ? (
          <Link
            className="button button--primary"
            to={`/review?date=${plan.date}`}
          >
            View today’s review
          </Link>
        ) : (
          <button
            className="button button--quiet"
            disabled={close.isPending}
            onClick={() => close.mutate()}
            type="button"
          >
            Close day and carry unfinished work
          </button>
        )}
      </footer>

      {addToPlanOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-labelledby="add-plan-title"
            aria-modal="true"
            className="dialog"
            onKeyDown={handleDialogKeyDown}
            ref={dialogRef}
            role="dialog"
          >
            <header>
              <div>
                <p className="eyebrow">Bounded backlog search</p>
                <h2 id="add-plan-title">Add one commitment</h2>
              </div>
              <button
                aria-label="Close add commitment dialog"
                className="icon-button"
                data-dialog-close
                onClick={() => setAddToPlanOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>
            {backlog.isPending && (
              <LoadingState label="Finding a few candidates…" />
            )}
            {backlog.error && <ErrorState error={backlog.error} />}
            {backlog.data?.items.length === 0 && (
              <p>No backlog tasks are waiting.</p>
            )}
            <ul className="candidate-list">
              {backlog.data?.items.map((task) => (
                <li key={task.id}>
                  <span>
                    <strong>{task.title}</strong>
                    <small>{task.estimateMinutes ?? '—'} min</small>
                  </span>
                  <span className="candidate-actions">
                    {(['primary', 'secondary', 'optional'] as const).map(
                      (role) => (
                        <button
                          disabled={add.isPending}
                          key={role}
                          onClick={() => add.mutate({ task, role })}
                          type="button"
                        >
                          {role}
                        </button>
                      ),
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
