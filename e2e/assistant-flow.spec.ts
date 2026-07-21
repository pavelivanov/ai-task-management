import { expect, test } from '@playwright/test';

const apiUrl = 'http://127.0.0.1:3002';
const webUrl = 'http://127.0.0.1:5174';

test('@assistant requires confirmation before creating extracted tasks', async ({
  page,
}) => {
  await page.request
    .post(`${apiUrl}/auth/e2e/login`, {
      data: {
        email: 'assistant-pilot@example.test',
        displayName: 'Assistant Pilot',
      },
      headers: { Origin: webUrl },
    })
    .then((response) => expect(response.ok()).toBe(true));

  await page.goto('/inbox');
  await page
    .getByLabel('Quick capture')
    .fill('Prepare assistant brief and send assistant update');
  await page.getByRole('button', { name: 'Extract tasks' }).click();
  await expect(
    page.getByRole('heading', { name: 'Create extracted tasks' }),
  ).toBeVisible();

  const before = await page.request.get(`${apiUrl}/tasks?status=backlog`);
  expect((await before.json()).items).toHaveLength(0);

  const accepted = page.waitForResponse(
    (response) =>
      response.url().includes('/assistant/suggestions/') &&
      response.url().endsWith('/accept'),
  );
  await page.getByRole('button', { name: 'Create tasks' }).click();
  await accepted;
  await page.getByRole('link', { name: 'Backlog' }).click();
  await expect(page.getByText('Prepare assistant brief')).toBeVisible();
  await expect(page.getByText('Send assistant update')).toBeVisible();
});
