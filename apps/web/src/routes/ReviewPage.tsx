import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  generateDailyReview,
  getDailyReview,
  saveReflection,
} from '../features/reviews/review-api';
import { ErrorState, LoadingState } from '../features/ui/AsyncState';
import { isApiError } from '../lib/api-client';
import { formatMinutes, localDateInTimezone } from '../lib/date';
import { queryKeys } from '../lib/query-client';
import { useAuthenticatedUser } from './use-authenticated-user';

export function ReviewPage() {
  const user = useAuthenticatedUser();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const date =
    searchParams.get('date') ?? localDateInTimezone(new Date(), user.timezone);
  const review = useQuery({
    queryKey: queryKeys.review(user.id, date),
    queryFn: () => getDailyReview(date),
    retry: false,
  });
  const generate = useMutation({
    mutationFn: () => generateDailyReview(date),
    onSuccess: (data) =>
      queryClient.setQueryData(queryKeys.review(user.id, date), data),
  });

  const notFound = isApiError(review.error) && review.error.status === 404;
  if (review.isPending) return <LoadingState label="Gathering outcomes…" />;
  if (review.error && !notFound) {
    return (
      <ErrorState error={review.error} retry={() => void review.refetch()} />
    );
  }

  return (
    <div className="page review-page">
      <header className="page-header review-header">
        <div>
          <p className="eyebrow">Outcome, not output</p>
          <h1>Daily review</h1>
          <p className="page-intro">
            A factual record of what moved. No score attached.
          </p>
        </div>
        <label className="date-field">
          Review date
          <input
            autoComplete="off"
            name="reviewDate"
            onChange={(event) => setSearchParams({ date: event.target.value })}
            type="date"
            value={date}
          />
        </label>
      </header>

      {(notFound || !review.data) && (
        <section className="empty-state review-empty">
          <p className="eyebrow">No snapshot yet</p>
          <h2>Generate this day from recorded work.</h2>
          <p>
            Plan items, lifecycle events, and focus segments remain the source
            of truth.
          </p>
          <button
            className="button button--primary"
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
            type="button"
          >
            Generate review
          </button>
          {generate.error && <ErrorState error={generate.error} />}
        </section>
      )}

      {review.data && (
        <ReviewContent date={date} review={review.data} userId={user.id} />
      )}
    </div>
  );
}

function ReviewContent({
  date,
  review,
  userId,
}: {
  date: string;
  review: NonNullable<Awaited<ReturnType<typeof getDailyReview>>>;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [reflection, setReflection] = useState(review.userReflection ?? '');
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => saveReflection(date, reflection.trim() || null),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.review(userId, date), data);
      setSaved(true);
    },
  });
  const regenerate = useMutation({
    mutationFn: () => generateDailyReview(date),
    onSuccess: (data) =>
      queryClient.setQueryData(queryKeys.review(userId, date), data),
  });

  return (
    <>
      <section className="review-hero" aria-labelledby="review-outcome-title">
        <span
          className={
            review.primaryOutcomeCompleted
              ? 'outcome-mark outcome-mark--done'
              : 'outcome-mark'
          }
          aria-hidden="true"
        >
          {review.primaryOutcomeCompleted ? '✓' : '○'}
        </span>
        <div>
          <p className="eyebrow">Primary outcome</p>
          <h2 id="review-outcome-title">
            {review.primaryOutcomeCompleted
              ? 'Completed as planned.'
              : 'Not completed today.'}
          </h2>
          <p>
            {formatMinutes(review.focusedMinutes)} of recorded focus across{' '}
            {review.focusSessions} session
            {review.focusSessions === 1 ? '' : 's'}.
          </p>
        </div>
      </section>

      <dl className="metric-ledger">
        <div>
          <dt>Focused time</dt>
          <dd>{formatMinutes(review.focusedMinutes)}</dd>
        </div>
        <div>
          <dt>Planned completed</dt>
          <dd>{review.completedPlannedTasks}</dd>
        </div>
        <div>
          <dt>Unplanned completed</dt>
          <dd>{review.completedUnplannedTasks}</dd>
        </div>
        <div>
          <dt>Carried over</dt>
          <dd>{review.carriedOverTasks}</dd>
        </div>
        <div>
          <dt>Interruptions</dt>
          <dd>{review.interruptionCount}</dd>
        </div>
      </dl>

      <section className="reflection-panel" aria-labelledby="reflection-title">
        <div>
          <p className="eyebrow">Your perspective</p>
          <h2 id="reflection-title">What should tomorrow remember?</h2>
        </div>
        <label>
          Reflection
          <textarea
            autoComplete="off"
            maxLength={10_000}
            name="reflection"
            onChange={(event) => {
              setReflection(event.target.value);
              setSaved(false);
            }}
            placeholder="Name what helped, what resisted, and what deserves a different choice…"
            rows={6}
            value={reflection}
          />
        </label>
        <div className="panel-actions">
          <button
            className="button button--primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            type="button"
          >
            Save reflection
          </button>
          {saved && <span role="status">Saved</span>}
          <button
            className="text-button"
            disabled={regenerate.isPending}
            onClick={() => regenerate.mutate()}
            type="button"
          >
            Recompute facts
          </button>
        </div>
        {save.error && <ErrorState error={save.error} />}
      </section>

      {review.assistantSummary && (
        <aside className="assistant-note" aria-label="Assistant recommendation">
          <p className="eyebrow">One recommendation</p>
          <p>{review.assistantSummary}</p>
        </aside>
      )}
    </>
  );
}
