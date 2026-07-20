import { Navigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { isApiError } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';
import { e2eLogin, loginUrl, useCurrentUser } from './auth';

export function LoginPage({ callback = false }: { callback?: boolean }) {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const testLogin = useMutation({
    mutationFn: e2eLogin,
    onSuccess: (authenticatedUser) =>
      queryClient.setQueryData(queryKeys.auth, authenticatedUser),
  });
  if (user.data) return <Navigate replace to="/today" />;

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <p className="eyebrow">A quieter way to finish</p>
        <h1 id="login-title">Make today small enough to complete.</h1>
        <p className="lede">
          Capture what arrives, choose one meaningful outcome, and keep the
          clock grounded in work the server actually recorded.
        </p>
        {callback && user.isPending ? (
          <p role="status">Finishing sign in…</p>
        ) : (
          <a className="button button--primary" href={loginUrl()}>
            Continue with Google
          </a>
        )}
        {import.meta.env.VITE_E2E_AUTH_ENABLED === 'true' && (
          <button
            className="button button--quiet"
            disabled={testLogin.isPending}
            onClick={() => testLogin.mutate()}
            type="button"
          >
            Enter deterministic workspace
          </button>
        )}
        {user.error && !isApiError(user.error) && (
          <p className="error-message" role="alert">
            Sign in could not be checked. Please try again.
          </p>
        )}
      </section>
      <aside className="login-note" aria-label="Product principle">
        <span aria-hidden="true">01</span>
        <p>No scores. No streak pressure. Just a clear record of what moved.</p>
      </aside>
    </main>
  );
}
