import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';

import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../features/behavior/behavior-api';
import { ErrorState, LoadingState } from '../features/ui/AsyncState';
import { queryKeys } from '../lib/query-client';
import { useAuthenticatedUser } from './use-authenticated-user';

export function NotificationsPage() {
  const user = useAuthenticatedUser();
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: queryKeys.notifications(user.id),
    queryFn: getNotifications,
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.notifications(user.id),
    });
  const read = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: refresh,
  });
  const readAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: refresh,
  });

  if (notifications.isPending)
    return <LoadingState label="Opening reminders…" />;
  if (notifications.error) {
    return (
      <ErrorState
        error={notifications.error}
        retry={() => void notifications.refetch()}
      />
    );
  }
  const data = notifications.data;
  return (
    <div className="page notifications-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Deterministic signals</p>
          <h1>Notifications</h1>
          <p className="page-intro">
            Only planning, waiting, deadline, and review signals appear here.
          </p>
        </div>
        {data.unreadCount > 0 && (
          <button
            className="button button--quiet"
            disabled={readAll.isPending}
            onClick={() => readAll.mutate()}
            type="button"
          >
            Mark all read
          </button>
        )}
      </header>
      <div className="notification-list">
        {data.items.length === 0 ? (
          <p className="empty-note">No notifications. Quiet is the default.</p>
        ) : (
          data.items.map((item) => (
            <article
              className={`notification-row ${item.readAt ? '' : 'notification-row--unread'}`}
              key={item.id}
            >
              <div>
                <p className="eyebrow">{item.type.replaceAll('_', ' ')}</p>
                <h2>{item.title}</h2>
                <p>{item.body}</p>
                <small>{new Date(item.createdAt).toLocaleString()}</small>
              </div>
              <div className="notification-actions">
                <Link
                  className="button button--quiet"
                  onClick={() => {
                    if (!item.readAt) read.mutate(item.id);
                  }}
                  to={item.deepLink}
                >
                  Open
                </Link>
                {!item.readAt && (
                  <button
                    className="text-button"
                    disabled={read.isPending}
                    onClick={() => read.mutate(item.id)}
                    type="button"
                  >
                    Mark read
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
