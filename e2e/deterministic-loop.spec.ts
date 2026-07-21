import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://execution_assistant:local-development-only@localhost:5432/execution_assistant_test';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page
    .getByRole('button', { name: 'Enter deterministic workspace' })
    .click();
  await expect(page).toHaveURL(/\/today$/);
}

test('completes the deterministic execution loop and reconciles focus after refresh', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET')
      writes.push(`${request.method()} ${request.url()}`);
  });

  await login(page);

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Workday starts').fill('09:00');
  await page.getByLabel('Workday ends').fill('10:00');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(
    page.getByText('Settings saved. Date boundaries now use this timezone.'),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Inbox' }).click();
  await page.getByLabel('Quick capture').fill('Ship deterministic review');
  await page.getByLabel('Estimate minutes').fill('50');
  await page.getByRole('button', { name: 'Capture' }).click();
  await expect(page.getByText('Ship deterministic review')).toBeVisible();
  await page.getByLabel('Quick capture').fill('Prepare pilot notes');
  await page.getByLabel('Estimate minutes').fill('40');
  await page.getByRole('button', { name: 'Capture' }).click();

  const primaryInbox = page
    .getByRole('listitem')
    .filter({ hasText: 'Ship deterministic review' });
  await primaryInbox.getByRole('button', { name: 'Backlog' }).click();
  const secondaryInbox = page
    .getByRole('listitem')
    .filter({ hasText: 'Prepare pilot notes' });
  await secondaryInbox.getByRole('button', { name: 'Backlog' }).click();
  await expect(
    page.getByRole('heading', { name: 'Nothing waiting for a decision.' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Create today’s plan' }).click();
  await page.getByRole('button', { name: 'Add commitment' }).click();
  const primaryCandidate = page
    .getByRole('listitem')
    .filter({ hasText: 'Ship deterministic review' });
  await primaryCandidate.getByRole('button', { name: 'primary' }).click();
  const secondaryCandidate = page
    .getByRole('listitem')
    .filter({ hasText: 'Prepare pilot notes' });
  await secondaryCandidate.getByRole('button', { name: 'secondary' }).click();
  await page
    .getByRole('button', { name: 'Close add commitment dialog' })
    .click();
  await expect(
    page.getByText(/1h 30m is planned inside 1h of available time/),
  ).toBeVisible();

  const primarySection = page.getByRole('region', { name: 'Primary outcome' });
  await primarySection.getByRole('button', { name: 'Start' }).click();
  const timer = page.getByRole('timer');
  await expect(timer).toBeVisible();
  await expect(timer).not.toHaveText('00:00:00', { timeout: 4_000 });
  await page.screenshot({
    path: 'output/playwright/focus.png',
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  const pausedTime = await timer.textContent();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Ship deterministic review' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText(pausedTime ?? '');

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByLabel('Capture distraction').fill('Reply to the pilot email');
  await page.getByRole('button', { name: 'Send to inbox' }).click();
  await expect(
    page.getByText('Distraction captured. Stay with the current work.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Waiting' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page
    .getByLabel('Outcome when complete')
    .fill('Review shipped to the pilot');
  await page.getByRole('button', { name: 'Complete' }).click();

  await page.goto('/today');
  await expect(
    primarySection.getByRole('heading', { name: 'Ship deterministic review' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Close day and carry unfinished work' })
    .click();
  await page.getByRole('link', { name: 'View today’s review' }).click();
  await expect(page.getByText('Completed as planned.')).toBeVisible();
  await expect(
    page
      .getByText('Planned completed', { exact: true })
      .locator('..')
      .locator('dd'),
  ).toHaveText('1');
  await expect(
    page.getByText('Carried over', { exact: true }).locator('..').locator('dd'),
  ).toHaveText('1');
  await page.screenshot({
    path: 'output/playwright/review.png',
    fullPage: true,
  });

  await page.getByRole('link', { name: 'Backlog' }).click();
  await expect(page.getByText('Prepare pilot notes')).toBeVisible();

  const database = new Client({ connectionString: testDatabaseUrl });
  await database.connect();
  try {
    const plans = await database.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM daily_plans',
    );
    expect(plans.rows[0]?.count).toBe('1');
  } finally {
    await database.end();
  }

  expect(writes.some((request) => /\/ai|\/suggestions/.test(request))).toBe(
    false,
  );
  expect(writes.some((request) => /timer|tick/.test(request))).toBe(false);
});

test('@a11y core screens have no serious or critical axe violations', async ({
  page,
}) => {
  await login(page);
  const routes = [
    '/today',
    '/focus',
    '/inbox',
    '/backlog',
    '/review',
    '/notifications',
    '/settings',
  ];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator('#main-content')).toBeVisible();
    const surface = page.locator('.page, .focus-page').first();
    await expect(surface).toBeVisible();
    await surface.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      );
    });
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
    );
    expect(
      blocking,
      `${route}: ${blocking.map((item) => item.id).join(', ')}`,
    ).toEqual([]);
  }
});

test('responsive shell remains usable at phone, tablet, and desktop widths', async ({
  page,
}) => {
  await login(page);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/today');
    await expect(page.locator('#main-content')).toBeVisible();
    if (viewport.width < 900) {
      await page.getByRole('button', { name: 'Toggle navigation' }).click();
      await expect(page.getByRole('navigation')).toBeVisible();
    } else {
      await expect(page.getByRole('navigation')).toBeVisible();
    }
  }
});
