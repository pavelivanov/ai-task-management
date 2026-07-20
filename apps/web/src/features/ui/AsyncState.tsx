import { isApiError } from '../../lib/api-client';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state-panel" role="status">
      <span className="loading-mark" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="state-panel state-panel--error" role="alert">
      <p>
        {isApiError(error)
          ? error.message
          : 'Something went quiet unexpectedly.'}
      </p>
      {retry && (
        <button className="button button--quiet" onClick={retry} type="button">
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <p className="eyebrow">Clear space</p>
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  );
}
