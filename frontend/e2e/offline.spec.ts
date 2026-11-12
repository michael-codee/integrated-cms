import { expect, test } from '@playwright/test';

const USER = process.env.E2E_USER;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(!USER || !PASSWORD, 'Set E2E_USER and E2E_PASSWORD to run the end-to-end tests.');

test('attendance recorded offline uploads exactly once when the connection returns', async ({ page, context }) => {
  const marker = `e2e-offline-${Date.now()}`;
  // A random past date keeps repeated runs from colliding with the one-record-per-service rule.
  const day = new Date(Date.UTC(2005 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 27)));
  const iso = day.toISOString().slice(0, 10);

  await page.goto('/login');
  await page.fill('input[autocomplete="username"]', USER!);
  await page.fill('input[type="password"]', PASSWORD!);
  await page.click('button[type="submit"]');
  await expect(page.getByRole('button', { name: 'Toggle dark mode' })).toBeVisible();

  // The service worker must control the page for the app to keep working offline.
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });
  await page.goto('/attendance');
  await page.getByRole('button', { name: 'Record attendance' }).first().click();
  const dialog = page.getByRole('dialog');
  // Lookups are loaded while online; the rest happens offline.
  await expect(dialog.locator('select').nth(1).locator('option').nth(1)).toBeAttached();
  await context.setOffline(true);

  await dialog.locator('select').nth(0).selectOption({ index: 1 });
  await dialog.locator('select').nth(1).selectOption({ index: 1 });
  await dialog.locator('input[type="date"]').fill(iso);
  await dialog.getByLabel('Men', { exact: true }).fill('12');
  await dialog.getByLabel('Women', { exact: true }).fill('20');
  await dialog.getByLabel('Notes', { exact: true }).fill(marker);
  await dialog.getByRole('button', { name: 'Save attendance' }).click();
  await expect(page.getByText(/^Saved on this device\./)).toBeVisible();

  await page.getByRole('link', { name: /to upload/ }).click();
  await expect(page.getByText(/Attendance .*: 32 present/)).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('Everything is uploaded')).toBeVisible({ timeout: 30_000 });

  // The server holds exactly one copy.
  const login = await page.request.post('/api/auth/login/', { data: { username: USER, password: PASSWORD } });
  const token = (await login.json()).access;
  const res = await page.request.get(`/api/attendance/?date=${iso}&page_size=100`, { headers: { Authorization: `Bearer ${token}` } });
  const rows = (await res.json()).results.filter((r: { notes: string }) => r.notes === marker);
  expect(rows).toHaveLength(1);
  expect(rows[0].total).toBe(32);
});
