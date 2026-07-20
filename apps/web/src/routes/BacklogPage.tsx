import type { Task, TaskCategory, TaskStatus } from '@execution/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  addPlanItem,
  createTodayPlan,
  getTodayPlan,
} from '../features/daily-plan/daily-plan-api';
import {
  createTask,
  listTasks,
  taskFiltersKey,
  transitionTask,
  updateTask,
} from '../features/tasks/task-api';
import { listProjects } from '../features/tasks/project-api';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../features/ui/AsyncState';
import { isApiError } from '../lib/api-client';
import { queryKeys } from '../lib/query-client';
import { useAuthenticatedUser } from './use-authenticated-user';

type ViewFilter = 'all' | TaskCategory | 'due-soon' | 'blocked';

const viewFilters: readonly ViewFilter[] = [
  'all',
  'work',
  'personal',
  'due-soon',
  'blocked',
];

export function BacklogPage() {
  const user = useAuthenticatedUser();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const view = viewFilters.includes(requestedView as ViewFilter)
    ? (requestedView as ViewFilter)
    : 'all';
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const cursor = searchParams.get('cursor');
  const projectId = searchParams.get('project') ?? '';
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [dueSoonBoundary] = useState(
    () => Date.now() + 7 * 24 * 60 * 60 * 1_000,
  );
  const updateLocation = (updates: {
    cursor?: string | null;
    project?: string | null;
    view?: ViewFilter | null;
  }) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next);
  };
  const serverFilters: {
    status: TaskStatus;
    category?: TaskCategory;
    cursor?: string;
    limit: number;
    projectId?: string;
  } =
    view === 'blocked'
      ? { status: 'blocked', limit: 50 }
      : {
          status: 'backlog',
          limit: 50,
          ...(view === 'work' || view === 'personal' ? { category: view } : {}),
        };
  if (cursor) serverFilters.cursor = cursor;
  if (projectId) serverFilters.projectId = projectId;
  const projects = useQuery({
    queryKey: queryKeys.projects(user.id),
    queryFn: listProjects,
  });
  const tasks = useQuery({
    queryKey: queryKeys.tasks(user.id, taskFiltersKey(serverFilters)),
    queryFn: () => listTasks(serverFilters),
  });
  const visibleTasks = useMemo(() => {
    if (view !== 'due-soon') return tasks.data?.items ?? [];
    return (tasks.data?.items ?? []).filter(
      (task) => task.dueAt && new Date(task.dueAt).getTime() <= dueSoonBoundary,
    );
  }, [dueSoonBoundary, tasks.data?.items, view]);
  const invalidateTasks = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['private', user.id, 'tasks'],
    });
  };
  const create = useMutation({
    mutationFn: () =>
      createTask({ title, category: 'work', priority: 'normal' }),
    onSuccess: async () => {
      setTitle('');
      await invalidateTasks();
    },
  });
  const transition = useMutation({
    mutationFn: ({
      task,
      action,
    }: {
      task: Task;
      action: 'archive' | 'complete';
    }) => transitionTask(task.id, action),
    onSuccess: invalidateTasks,
    onError: (error) =>
      setMessage(isApiError(error) ? error.message : 'The task changed.'),
  });
  const edit = useMutation({
    mutationFn: () => {
      if (!editingId) throw new Error('Task unavailable.');
      return updateTask(editingId, { title: editTitle });
    },
    onSuccess: async () => {
      setEditingId(null);
      setEditTitle('');
      await invalidateTasks();
    },
    onError: (error) =>
      setMessage(
        isApiError(error) ? error.message : 'The edit could not be saved.',
      ),
  });
  const addToToday = useMutation({
    mutationFn: async (task: Task) => {
      let plan;
      try {
        plan = await getTodayPlan();
      } catch (error) {
        if (!isApiError(error) || error.status !== 404) throw error;
        plan = await createTodayPlan();
      }
      return addPlanItem({
        taskId: task.id,
        role: 'optional',
        expectedPlanVersion: plan.version,
        ...(task.estimateMinutes
          ? { plannedDurationMinutes: task.estimateMinutes }
          : {}),
      });
    },
    onSuccess: async () => {
      setMessage('Added to today as optional work.');
      await Promise.all([
        invalidateTasks(),
        queryClient.invalidateQueries({ queryKey: queryKeys.today(user.id) }),
      ]);
    },
    onError: (error) =>
      setMessage(isApiError(error) ? error.message : 'Could not add the task.'),
  });

  return (
    <div className="page page--queue">
      <header className="page-header">
        <div>
          <p className="eyebrow">Work with somewhere to go</p>
          <h1>Backlog</h1>
          <p className="page-intro">
            Keep future work legible. Today only sees what you deliberately pull
            in.
          </p>
        </div>
      </header>
      <form
        className="capture-bar capture-bar--compact"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) create.mutate();
        }}
      >
        <label htmlFor="backlog-create">Create task</label>
        <div>
          <input
            autoComplete="off"
            id="backlog-create"
            maxLength={240}
            onChange={(event) => setTitle(event.target.value)}
            name="backlogTitle"
            placeholder="A defined piece of work…"
            value={title}
          />
          <button
            className="button button--primary"
            disabled={!title.trim() || create.isPending}
            type="submit"
          >
            Add
          </button>
        </div>
      </form>
      <div className="filter-bar" aria-label="Backlog filters">
        {viewFilters.map((filter) => (
          <button
            aria-pressed={view === filter}
            className={
              view === filter
                ? 'filter-chip filter-chip--active'
                : 'filter-chip'
            }
            key={filter}
            onClick={() => {
              updateLocation({
                cursor: null,
                view: filter === 'all' ? null : filter,
              });
              setCursorHistory([]);
            }}
            type="button"
          >
            {filter.replace('-', ' ')}
          </button>
        ))}
        <label className="project-filter">
          <span className="sr-only">Filter by project</span>
          <select
            aria-label="Filter by project"
            name="projectFilter"
            onChange={(event) => {
              updateLocation({
                cursor: null,
                project: event.target.value || null,
              });
              setCursorHistory([]);
            }}
            value={projectId}
          >
            <option value="">All projects</option>
            {projects.data?.items.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {message && (
        <p className="inline-message" role="status">
          {message}
        </p>
      )}
      {tasks.isPending && <LoadingState label="Reading the backlog…" />}
      {tasks.error && (
        <ErrorState error={tasks.error} retry={() => void tasks.refetch()} />
      )}
      {tasks.data && visibleTasks.length === 0 && (
        <EmptyState title="This view is clear.">
          Change the filter or define the next piece of work above.
        </EmptyState>
      )}
      {visibleTasks.length > 0 && (
        <ul className="task-list" aria-label="Backlog tasks">
          {visibleTasks.map((task) => (
            <li className="task-row" key={task.id}>
              <div className="task-copy">
                <span
                  className={`priority-dot priority-dot--${task.priority}`}
                />
                <span>
                  {editingId === task.id ? (
                    <form
                      className="inline-edit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (editTitle.trim()) edit.mutate();
                      }}
                    >
                      <label className="sr-only" htmlFor={`edit-${task.id}`}>
                        Edit task title
                      </label>
                      <input
                        autoComplete="off"
                        id={`edit-${task.id}`}
                        maxLength={240}
                        name="taskTitle"
                        onChange={(event) => setEditTitle(event.target.value)}
                        value={editTitle}
                      />
                      <button
                        className="button button--small"
                        disabled={!editTitle.trim() || edit.isPending}
                        type="submit"
                      >
                        Save
                      </button>
                    </form>
                  ) : (
                    <strong>{task.title}</strong>
                  )}
                  <small>
                    {task.category} ·{' '}
                    {task.estimateMinutes
                      ? `${task.estimateMinutes} min`
                      : 'estimate open'}
                    {task.dueAt
                      ? ` · due ${new Date(task.dueAt).toLocaleDateString()}`
                      : ''}
                  </small>
                </span>
              </div>
              <div className="row-actions">
                {task.status === 'backlog' && (
                  <button
                    className="button button--small button--primary"
                    disabled={addToToday.isPending}
                    onClick={() => addToToday.mutate(task)}
                    type="button"
                  >
                    Add to today
                  </button>
                )}
                <button
                  className="button button--small"
                  disabled={transition.isPending}
                  onClick={() =>
                    transition.mutate({ task, action: 'complete' })
                  }
                  type="button"
                >
                  Complete
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setEditingId(task.id);
                    setEditTitle(task.title);
                  }}
                  type="button"
                >
                  Edit
                </button>
                <button
                  className="text-button"
                  disabled={transition.isPending}
                  onClick={() => {
                    if (!window.confirm(`Archive “${task.title}”?`)) return;
                    transition.mutate({ task, action: 'archive' });
                  }}
                  type="button"
                >
                  Archive
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <nav className="pagination" aria-label="Backlog pages">
        <button
          className="button button--small"
          disabled={cursorHistory.length === 0}
          onClick={() => {
            const history = [...cursorHistory];
            updateLocation({ cursor: history.pop() || null });
            setCursorHistory(history);
          }}
          type="button"
        >
          Previous page
        </button>
        <button
          className="button button--small"
          disabled={!tasks.data?.nextCursor}
          onClick={() => {
            setCursorHistory((history) => [...history, cursor ?? '']);
            updateLocation({ cursor: tasks.data?.nextCursor ?? null });
          }}
          type="button"
        >
          Next page
        </button>
      </nav>
    </div>
  );
}
