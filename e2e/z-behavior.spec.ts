import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://execution_assistant:local-development-only@localhost:5432/execution_assistant_test';
const apiUrl = 'http://127.0.0.1:3002';
const webUrl = 'http://127.0.0.1:5174';

async function resetPilot(): Promise<void> {
  const database = new Client({ connectionString: testDatabaseUrl });
  await database.connect();
  try {
    await database.query('DELETE FROM users WHERE email = $1', [
      'pilot@example.test',
    ]);
  } finally {
    await database.end();
  }
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page
    .getByRole('button', { name: 'Enter deterministic workspace' })
    .click();
  await expect(page).toHaveURL(/\/today$/);
}

async function apiPost<T>(
  page: Page,
  path: string,
  data: Record<string, unknown>,
): Promise<T> {
  const response = await page.request.post(`${apiUrl}${path}`, {
    data,
    headers: { Origin: webUrl },
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

async function finishPageAnimations(page: Page): Promise<void> {
  await page
    .locator('.page, .focus-page')
    .first()
    .evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      );
    });
}

function installGrantedPushMock(page: Page): Promise<void> {
  return page.addInitScript(() => {
    const subscription = {
      endpoint: 'https://push.example.test/e2e-browser',
      toJSON: () => ({
        endpoint: 'https://push.example.test/e2e-browser',
        expirationTime: null,
        keys: { p256dh: 'e2e-public-key', auth: 'e2e-auth-secret' },
      }),
      unsubscribe: async () => {
        sessionStorage.removeItem('e2e-push-subscribed');
        return true;
      },
    };
    const registration = {
      pushManager: {
        getSubscription: async () =>
          sessionStorage.getItem('e2e-push-subscribed') === 'true'
            ? subscription
            : null,
        subscribe: async () => {
          sessionStorage.setItem('e2e-push-subscribed', 'true');
          return subscription;
        },
      },
    };
    class MockNotification {
      static permission: NotificationPermission = 'default';
      static async requestPermission(): Promise<NotificationPermission> {
        const state = window as typeof window & {
          __permissionRequests?: number;
        };
        state.__permissionRequests = (state.__permissionRequests ?? 0) + 1;
        MockNotification.permission = 'granted';
        return 'granted';
      }
    }
    Object.defineProperty(window, 'Notification', { value: MockNotification });
    Object.defineProperty(window, 'PushManager', {
      value: class PushManager {},
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: async () => registration,
        getRegistration: async () => registration,
      },
    });
  });
}

function installDeniedPushMock(page: Page): Promise<void> {
  return page.addInitScript(() => {
    class MockNotification {
      static permission: NotificationPermission = 'default';
      static async requestPermission(): Promise<NotificationPermission> {
        const state = window as typeof window & {
          __permissionRequests?: number;
        };
        state.__permissionRequests = (state.__permissionRequests ?? 0) + 1;
        MockNotification.permission = 'denied';
        return 'denied';
      }
    }
    Object.defineProperty(window, 'Notification', { value: MockNotification });
    Object.defineProperty(window, 'PushManager', {
      value: class PushManager {},
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: async () => null },
    });
  });
}

test.beforeEach(async () => resetPilot());

test('@behavior requests permission contextually, confirms protected work, starts a waiting suggestion, and deep-links notifications', async ({
  page,
}) => {
  await installGrantedPushMock(page);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${request.url()}`);
    }
  });
  await login(page);

  const utcHour = new Date().getUTCHours();
  const offset = 12 - utcHour;
  const timezone =
    offset === 0
      ? 'UTC'
      : offset > 0
        ? `Etc/GMT-${offset}`
        : `Etc/GMT+${Math.abs(offset)}`;
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('IANA timezone').fill(timezone);
  await page.getByLabel('Reserve a protected focus window').check();
  await page.getByLabel('Protected start').fill('11:00');
  await page.getByLabel('Protected end').fill('13:00');
  await page.getByLabel('Allow notification registration').check();
  await page.getByLabel('Morning planning reminder').check();
  await page
    .getByLabel('Assistant interruption level')
    .selectOption('proactive');
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __permissionRequests?: number })
          .__permissionRequests ?? 0,
    ),
  ).toBe(0);
  await page.getByRole('button', { name: 'Enable browser alerts' }).click();
  await expect(
    page.getByText(
      'Browser alerts are enabled for the benefits selected above.',
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __permissionRequests?: number })
          .__permissionRequests ?? 0,
    ),
  ).toBe(1);

  const personal = await apiPost<{ id: string }>(page, '/tasks', {
    title: 'Personal appointment',
    category: 'personal',
    estimateMinutes: 15,
  });
  await apiPost(page, '/daily-plans/today', {});
  await apiPost(page, '/daily-plans/today/items', {
    taskId: personal.id,
    role: 'primary',
  });
  const shortWork = await apiPost<{ id: string }>(page, '/tasks', {
    title: 'Five minute work follow-up',
    estimateMinutes: 5,
    category: 'work',
  });
  await apiPost(page, '/tasks', {
    title: 'Due risk item',
    estimateMinutes: 20,
    dueAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });

  await page.goto('/today');
  const primary = page.getByRole('region', { name: 'Primary outcome' });
  await primary.getByRole('button', { name: 'Start' }).click();
  await expect(
    page.getByRole('heading', { name: 'Start personal work anyway?' }),
  ).toBeVisible();
  await finishPageAnimations(page);
  await page.screenshot({
    path: 'output/playwright/protected-hours.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await primary.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('button', { name: 'Start anyway' }).click();
  await expect(page).toHaveURL(/\/focus$/);
  await page.getByLabel('Expected wait (minutes)').fill('15');
  await page.getByRole('button', { name: 'Waiting' }).click();

  await page.reload();
  const waitingCard = page
    .getByRole('listitem')
    .filter({ hasText: 'Five minute work follow-up' });
  await expect(waitingCard).toBeVisible({ timeout: 20_000 });
  await finishPageAnimations(page);
  await page.screenshot({
    path: 'output/playwright/waiting-suggestions.png',
    fullPage: true,
  });
  await waitingCard.getByRole('button', { name: 'Start this' }).click();
  await expect(
    page.getByRole('heading', { name: 'Five minute work follow-up' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Notifications' }).click();
  const dueNotification = page
    .locator('.notification-row')
    .filter({ hasText: 'Deadline within 24 hours' });
  await expect(dueNotification).toBeVisible({ timeout: 20_000 });
  await finishPageAnimations(page);
  await page.screenshot({
    path: 'output/playwright/notifications.png',
    fullPage: true,
  });
  await dueNotification.getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/backlog$/);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    writes.some(
      (entry) =>
        entry.includes('DELETE') && entry.includes('/push/subscriptions'),
    ),
  ).toBe(true);
  expect(shortWork.id).toBeTruthy();
});

test('@behavior denied permission preserves the in-app fallback', async ({
  page,
}) => {
  await installDeniedPushMock(page);
  await login(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Allow notification registration').check();
  await page.getByLabel('End-of-day reminder').check();
  await page.getByRole('button', { name: 'Enable browser alerts' }).click();
  await expect(
    page.getByText(
      'Browser permission was denied. Reminders remain available in the app.',
    ),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Notifications' }).click();
  await expect(
    page.getByRole('heading', { name: 'Notifications' }),
  ).toBeVisible();
});
