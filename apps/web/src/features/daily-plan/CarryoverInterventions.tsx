import type { DailyPlan, ResolveCarryover, Task } from '@execution/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { isApiError } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';
import { resolveCarryover } from './daily-plan-api';

type CarryoverAction = ResolveCarryover['action'];

const actionLabels: Record<CarryoverAction, string> = {
  break_down: 'Break it down',
  postpone: 'Postpone it',
  archive: 'Archive it',
  recommit: 'Recommit deliberately',
};

function nextDate(date: string): string {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + 1);
  return instant.toISOString().slice(0, 10);
}

function dueAtForDate(date: string): string {
  return new Date(`${date}T12:00:00`).toISOString();
}

function CarryoverChoice({
  disabled,
  planDate,
  planVersion,
  task,
  onResolve,
}: {
  disabled: boolean;
  planDate: string;
  planVersion: number;
  task: Task;
  onResolve: (taskId: string, input: ResolveCarryover) => void;
}) {
  const [action, setAction] = useState<CarryoverAction>('break_down');
  const [firstStep, setFirstStep] = useState('');
  const [secondStep, setSecondStep] = useState('');
  const [postponeDate, setPostponeDate] = useState(nextDate(planDate));

  return (
    <form
      aria-label={`Resolve carryover for ${task.title}`}
      className="carryover-choice"
      onSubmit={(event) => {
        event.preventDefault();
        switch (action) {
          case 'break_down':
            onResolve(task.id, {
              action,
              expectedPlanVersion: planVersion,
              subtasks: [firstStep, secondStep],
            });
            break;
          case 'postpone':
            onResolve(task.id, {
              action,
              expectedPlanVersion: planVersion,
              dueAt: dueAtForDate(postponeDate),
            });
            break;
          case 'archive':
          case 'recommit':
            onResolve(task.id, {
              action,
              expectedPlanVersion: planVersion,
            });
            break;
        }
      }}
    >
      <label>
        Make an explicit choice
        <select
          name="carryoverAction"
          onChange={(event) => setAction(event.target.value as CarryoverAction)}
          value={action}
        >
          {Object.entries(actionLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {action === 'break_down' && (
        <div className="carryover-fields">
          <label>
            First smaller step
            <input
              autoComplete="off"
              maxLength={240}
              name="firstStep"
              onChange={(event) => setFirstStep(event.target.value)}
              required
              value={firstStep}
            />
          </label>
          <label>
            Second smaller step
            <input
              autoComplete="off"
              maxLength={240}
              name="secondStep"
              onChange={(event) => setSecondStep(event.target.value)}
              required
              value={secondStep}
            />
          </label>
        </div>
      )}
      {action === 'postpone' && (
        <label>
          Revisit on
          <input
            min={nextDate(planDate)}
            name="postponeDate"
            onChange={(event) => setPostponeDate(event.target.value)}
            required
            type="date"
            value={postponeDate}
          />
        </label>
      )}
      <p className="field-help">
        Recommitment keeps the task in the backlog; it never schedules it
        automatically.
      </p>
      <button
        className="button button--primary"
        disabled={
          disabled ||
          (action === 'break_down' &&
            (!firstStep.trim() || !secondStep.trim())) ||
          (action === 'postpone' && !postponeDate)
        }
        type="submit"
      >
        Confirm choice
      </button>
    </form>
  );
}

export function CarryoverInterventions({
  plan,
  userId,
}: {
  plan: DailyPlan;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const resolve = useMutation({
    mutationFn: ({
      taskId,
      input,
    }: {
      taskId: string;
      input: ResolveCarryover;
    }) => resolveCarryover(taskId, input),
    onSuccess: async (nextPlan) => {
      setError(null);
      queryClient.setQueryData(queryKeys.today(userId), nextPlan);
      await queryClient.invalidateQueries({
        queryKey: ['private', userId, 'tasks'],
      });
    },
    onError: async (cause) => {
      setError(
        isApiError(cause)
          ? cause.message
          : 'The carryover choice could not be recorded.',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.today(userId) }),
        queryClient.invalidateQueries({
          queryKey: ['private', userId, 'tasks'],
        }),
      ]);
    },
  });
  const taskById = new Map(plan.items.map((item) => [item.taskId, item.task]));
  const signals = plan.carryoverSignals.filter(
    (signal) => signal.level !== null,
  );
  if (signals.length === 0) return null;

  return (
    <section
      aria-labelledby="carryover-interventions-title"
      className="carryover-interventions"
    >
      <div>
        <p className="eyebrow">Repeated carryover</p>
        <h2 id="carryover-interventions-title">
          Decide what deserves another day.
        </h2>
        <p>
          Carryover is a signal, not a score. Nothing below is scheduled
          automatically.
        </p>
      </div>
      {error && (
        <p className="inline-message inline-message--error" role="alert">
          {error}
        </p>
      )}
      <ul className="carryover-list">
        {signals.map((signal) => {
          const task = taskById.get(signal.taskId);
          if (!task) return null;
          return (
            <li key={signal.taskId}>
              <div>
                <strong>{task.title}</strong>
                <p>
                  Carried {signal.count} times.{' '}
                  {signal.level === 'warning' &&
                    'Check whether it still belongs in your next plan.'}
                  {signal.level === 'diagnosis' &&
                    'What is blocking progress: an unclear step, excessive size, missing information, an external dependency, or low value?'}
                  {signal.level === 'explicit_choice' &&
                    !signal.resolution &&
                    'Choose how this task should change before moving on.'}
                </p>
              </div>
              {signal.resolution ? (
                <p className="inline-message" role="status">
                  Choice recorded: {actionLabels[signal.resolution.action]}.
                </p>
              ) : signal.level === 'explicit_choice' ? (
                <CarryoverChoice
                  disabled={resolve.isPending}
                  onResolve={(taskId, input) =>
                    resolve.mutate({ taskId, input })
                  }
                  planDate={plan.date}
                  planVersion={plan.version}
                  task={task}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
