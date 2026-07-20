import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router';

import {
  logout,
  useCurrentUser,
  usePrivateCacheBoundary,
} from '../features/auth/auth';
import { RealtimeSync } from '../features/realtime/RealtimeSync';
import { LoadingState } from '../features/ui/AsyncState';
import { useUiStore } from '../features/ui/ui-store';
import { isApiError } from '../lib/api-client';

const navigation = [
  { to: '/today', label: 'Today', mark: 'T' },
  { to: '/focus', label: 'Focus', mark: 'F' },
  { to: '/inbox', label: 'Inbox', mark: 'I' },
  { to: '/backlog', label: 'Backlog', mark: 'B' },
  { to: '/review', label: 'Review', mark: 'R' },
  { to: '/settings', label: 'Settings', mark: 'S' },
];

export function AuthenticatedLayout() {
  usePrivateCacheBoundary();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });

  if (user.isPending) return <LoadingState label="Opening your workspace…" />;
  if (isApiError(user.error) && user.error.status === 401) {
    return <Navigate replace to="/login" />;
  }
  if (!user.data) return <Navigate replace to="/login" />;

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="mobile-header">
        <NavLink className="wordmark" to="/today">
          Fieldnote
        </NavLink>
        <button
          aria-expanded={mobileNavOpen}
          aria-label="Toggle navigation"
          className="icon-button"
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          type="button"
        >
          <span aria-hidden="true">☰</span>
        </button>
      </header>
      <aside
        className={`sidebar ${mobileNavOpen ? 'sidebar--open' : ''}`}
        aria-label="Primary"
      >
        <NavLink className="wordmark" to="/today">
          Fieldnote
          <small>execution workspace</small>
        </NavLink>
        <nav className="primary-nav">
          {navigation.map((item) => (
            <NavLink
              className={({ isActive }) =>
                `nav-link ${isActive ? 'nav-link--active' : ''}`
              }
              key={item.to}
              onClick={() => setMobileNavOpen(false)}
              to={item.to}
            >
              <span aria-hidden="true">{item.mark}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="account-block">
          <span className="avatar" aria-hidden="true">
            {(user.data.displayName ?? user.data.email)
              .slice(0, 1)
              .toUpperCase()}
          </span>
          <span>
            <strong>{user.data.displayName ?? 'Signed in'}</strong>
            <small>{user.data.email}</small>
          </span>
          <button
            className="text-button"
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
            type="button"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main-content" id="main-content">
        <Outlet context={{ user: user.data }} />
      </main>
      <RealtimeSync userId={user.data.id} />
    </div>
  );
}
