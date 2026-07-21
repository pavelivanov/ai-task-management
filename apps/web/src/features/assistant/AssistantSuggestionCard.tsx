import type {
  AssistantSuggestion,
  CarryoverDiagnosisOutput,
  DailyPlanSuggestionOutput,
  OutcomeSummaryOutput,
  TaskDecompositionOutput,
  TaskExtractionOutput,
} from '@execution/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { isApiError } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';
import {
  acceptAssistantSuggestion,
  getAssistantSuggestion,
  rejectAssistantSuggestion,
} from './assistant-api';

export function AssistantSuggestionCard({
  initial,
  userId,
  onApplied,
}: {
  initial: AssistantSuggestion;
  userId: string;
  onApplied?: () => void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(
    initial.output ? JSON.stringify(initial.output, null, 2) : '',
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const suggestion = useQuery({
    queryKey: queryKeys.assistantSuggestion(userId, initial.id),
    queryFn: () => getAssistantSuggestion(initial.id),
    initialData: initial,
    refetchInterval: (query) =>
      ['queued', 'running'].includes(query.state.data?.status ?? '')
        ? 1_000
        : false,
  });
  const accept = useMutation({
    mutationFn: () => {
      let output: Record<string, unknown> | undefined;
      if (editing) {
        const parsed = JSON.parse(editText) as unknown;
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error('The edited proposal must be a JSON object.');
        }
        output = parsed as Record<string, unknown>;
      }
      return acceptAssistantSuggestion(initial.id, output);
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(
        queryKeys.assistantSuggestion(userId, initial.id),
        data,
      );
      setLocalError(null);
      await onApplied?.();
    },
    onError: (error) =>
      setLocalError(
        isApiError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : 'The proposal could not be applied.',
      ),
  });
  const reject = useMutation({
    mutationFn: () => rejectAssistantSuggestion(initial.id),
    onSuccess: (data) => {
      queryClient.setQueryData(
        queryKeys.assistantSuggestion(userId, initial.id),
        data,
      );
      setLocalError(null);
    },
  });

  const current = suggestion.data;
  if (current.status === 'accepted' || current.status === 'rejected') {
    return (
      <p className="assistant-resolution" role="status">
        Proposal {current.status === 'accepted' ? 'applied' : 'dismissed'}.
      </p>
    );
  }
  if (current.status === 'queued' || current.status === 'running') {
    return (
      <section className="assistant-ledger" aria-live="polite">
        <p className="eyebrow">Assistant proposal</p>
        <h2>Working from the current task state…</h2>
        <p>No changes will be made before you review the result.</p>
      </section>
    );
  }
  if (current.status === 'failed' || current.status === 'expired') {
    return (
      <section className="assistant-ledger assistant-ledger--unavailable">
        <p className="eyebrow">Assistant unavailable</p>
        <h2>Keep working manually.</h2>
        <p>
          {current.errorCode === 'provider_refusal'
            ? 'The provider declined this request.'
            : 'The deterministic workspace is still fully available.'}
        </p>
      </section>
    );
  }
  if (!current.output) return null;

  return (
    <section
      className="assistant-ledger"
      aria-labelledby={`proposal-${current.id}`}
    >
      <header>
        <div>
          <p className="eyebrow">Review before applying</p>
          <h2 id={`proposal-${current.id}`}>{proposalTitle(current)}</h2>
        </div>
        <span>v{current.version}</span>
      </header>
      {editing ? (
        <label className="assistant-edit">
          Structured proposal
          <textarea
            aria-label="Edit structured proposal"
            onChange={(event) => setEditText(event.target.value)}
            rows={12}
            value={editText}
          />
        </label>
      ) : (
        <ProposalBody suggestion={current} />
      )}
      {localError && (
        <p className="error-message" role="alert">
          {localError}
        </p>
      )}
      <footer>
        <button
          className="button button--primary"
          disabled={accept.isPending}
          onClick={() => accept.mutate()}
          type="button"
        >
          {current.type === 'task_extraction'
            ? 'Create tasks'
            : 'Apply proposal'}
        </button>
        <button
          className="button"
          onClick={() => {
            setEditText(JSON.stringify(current.output, null, 2));
            setEditing((value) => !value);
            setLocalError(null);
          }}
          type="button"
        >
          {editing ? 'Preview' : 'Edit'}
        </button>
        <button
          className="text-button"
          disabled={reject.isPending}
          onClick={() => reject.mutate()}
          type="button"
        >
          Cancel
        </button>
      </footer>
    </section>
  );
}

function proposalTitle(suggestion: AssistantSuggestion): string {
  switch (suggestion.type) {
    case 'task_extraction':
      return 'Create extracted tasks';
    case 'daily_plan':
      return 'Apply this daily plan';
    case 'task_decomposition':
      return 'Create these next steps';
    case 'carryover_diagnosis':
      return 'Record this blocker';
    case 'outcome_summary':
      return 'Add this outcome summary';
  }
}

function ProposalBody({ suggestion }: { suggestion: AssistantSuggestion }) {
  switch (suggestion.type) {
    case 'task_extraction': {
      const output = suggestion.output as TaskExtractionOutput;
      return (
        <>
          <p>{output.summary}</p>
          <ol>
            {output.tasks.map((task) => (
              <li key={task.title}>
                {task.title} ·{' '}
                {task.estimateMinutes
                  ? `${task.estimateMinutes} min`
                  : 'estimate open'}
              </li>
            ))}
          </ol>
        </>
      );
    }
    case 'daily_plan': {
      const output = suggestion.output as DailyPlanSuggestionOutput;
      return (
        <>
          <p>{output.summary}</p>
          <dl className="assistant-plan-counts">
            {(['primary', 'secondary', 'optional'] as const).map((role) => (
              <div key={role}>
                <dt>{role}</dt>
                <dd>
                  {output.items.filter((item) => item.role === role).length}
                </dd>
              </div>
            ))}
          </dl>
          <p>{output.explanation}</p>
        </>
      );
    }
    case 'task_decomposition': {
      const output = suggestion.output as TaskDecompositionOutput;
      return (
        <>
          <p>{output.reason}</p>
          <ol>
            {output.subtasks.map((task) => (
              <li key={task.title}>
                {task.title} ·{' '}
                {task.estimateMinutes
                  ? `${task.estimateMinutes} min`
                  : 'estimate open'}
              </li>
            ))}
          </ol>
        </>
      );
    }
    case 'carryover_diagnosis': {
      const output = suggestion.output as CarryoverDiagnosisOutput;
      return (
        <>
          <blockquote>{output.question}</blockquote>
          <p>
            {output.blockReason.replaceAll('_', ' ')} · {output.details}
          </p>
        </>
      );
    }
    case 'outcome_summary': {
      const output = suggestion.output as OutcomeSummaryOutput;
      return <p>{output.summary}</p>;
    }
  }
}
