import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { createExecutionQueryClient } from './lib/query-client';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'pilot@example.test',
  displayName: 'Pilot User',
  avatarUrl: null,
  timezone: 'UTC',
};

class FakeEventSource {
  onopen: (() => void) | null = null;
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderApp(path: string) {
  const queryClient = createExecutionQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('authenticated application routing', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('routes a 401 through the private cache boundary to login', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in required.' },
            401,
          ),
        ),
    );

    renderApp('/today');

    expect(
      await screen.findByRole('heading', {
        name: 'Make today small enough to complete.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Continue with Google' }),
    ).toBeInTheDocument();
  });

  it('shows no-plan onboarding without fetching an unbounded backlog', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return Promise.resolve(jsonResponse(user));
      if (url.endsWith('/daily-plans/today')) {
        return Promise.resolve(
          jsonResponse(
            { code: 'DAILY_PLAN_NOT_FOUND', message: 'Not found.' },
            404,
          ),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/today');

    expect(
      await screen.findByRole('heading', {
        name: 'What would make today count?',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create today’s plan' }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('/tasks?')),
    ).toBe(false);
  });

  it('renders deterministic review facts and hides absent assistant content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/me'))
          return Promise.resolve(jsonResponse(user));
        if (url.endsWith('/reviews/daily/2026-07-20')) {
          return Promise.resolve(
            jsonResponse({
              id: '00000000-0000-4000-8000-000000000002',
              date: '2026-07-20',
              primaryOutcomeCompleted: true,
              focusedMinutes: 84,
              completedPlannedTasks: 2,
              completedUnplannedTasks: 1,
              carriedOverTasks: 1,
              focusSessions: 2,
              interruptionCount: 3,
              estimatedFocusMinutes: 70,
              estimateVarianceMinutes: 14,
              userReflection: null,
              assistantSummary: null,
              createdAt: '2026-07-20T18:00:00.000Z',
              updatedAt: '2026-07-20T18:00:00.000Z',
            }),
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp('/review?date=2026-07-20');

    expect(
      await screen.findByText('Completed as planned.'),
    ).toBeInTheDocument();
    expect(screen.getByText('1h 24m')).toBeInTheDocument();
    expect(
      screen.getByText(/Actual focused time was 14m over/),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Assistant recommendation'),
    ).not.toBeInTheDocument();
  });

  it('requires exact account deletion confirmations in settings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/me'))
          return Promise.resolve(jsonResponse(user));
        if (url.endsWith('/users/me/preferences')) {
          return Promise.resolve(
            jsonResponse({
              timezone: 'UTC',
              workdayStart: '09:00',
              workdayEnd: '17:00',
              primaryTaskLimit: 1,
              secondaryTaskLimit: 2,
              capacityWarningPercent: 10,
              protectedHoursEnabled: false,
              protectedHoursStart: null,
              protectedHoursEnd: null,
              notificationsEnabled: false,
              morningPlanningReminder: false,
              endOfDayReminder: false,
              aiInterruptionLevel: 'minimal',
            }),
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp('/settings');
    const remove = await screen.findByRole('button', {
      name: 'Permanently delete account',
    });
    expect(remove).toBeDisabled();

    const browser = userEvent.setup();
    await browser.type(screen.getByLabelText('Account email'), user.email);
    await browser.type(screen.getByLabelText('Type DELETE'), 'DELETE');
    expect(remove).toBeEnabled();
  });
});
