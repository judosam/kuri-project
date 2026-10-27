import { test, expect, type Page } from '@playwright/test';

const operator = { id: 7, full_name: 'Prabhu', email: 'prabhu@example.com', role: 'USER', is_active: true };
const nextOperator = { ...operator, id: 8, full_name: 'Rajesh Kumar', email: 'rajesh@example.com' };
const record = { id: 101, user_id: 7, user_name: 'Prabhu', name: 'Site inspection', status: 'NOT_COMPLETED',
  unique_id: 'CBE-110291-770091', created_at: '2026-09-20T08:00:00Z', assigned_at: '2026-09-24T04:00:00Z',
  images: [{ id: 1, photo_order: 1, captured_at: '2026-09-24T04:52:29Z', source: 'camera', latitude: 0, longitude: 0 }],
  street_address: '23C, Peelamedu, Coimbatore', owner_name_en: 'Govindan', description: '', source: 'captured' };

async function fixture(page: Page, role = 'ADMIN') {
  const assignments: unknown[] = [];
  await page.addInitScript(() => localStorage.setItem('token', 'isolated-ui-fixture'));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let data: unknown;
    if (url.pathname.endsWith('/auth/me')) data = { id: 1, email: 'account@example.com', full_name: 'Field Supervisor', role, is_active: true };
    else if (url.pathname.endsWith('/admin/dashboard')) data = {
      total_records: 26, today_records: 4, month_records: 26, total_users: 6,
      today_completed_records: 3, total_completed_records: 17, pending_records: 9, total_photos: 16, completion_rate: 65.4, recent_records: [],
      construction_yes_records: 8, mobile_numbers_collected: 12,
      inspector_stats: [
        { ...operator, user_id: 7, user_name: 'Prabhu', total_assigned: 16, pending: 6, completed: 10, today_completed: 2, completion_rate: 62.5 },
        { ...nextOperator, user_id: 8, user_name: 'Rajesh Kumar', total_assigned: 10, pending: 3, completed: 7, today_completed: 1, completion_rate: 70 },
      ],
    };
    else if (url.pathname.endsWith('/admin/assignment-operators')) data = [operator, nextOperator];
    else if (url.pathname.endsWith('/admin/users')) data = { users: [operator, nextOperator], total: 2, page: 1, page_size: 100 };
    else if (url.pathname.endsWith('/admin/records/reassign')) {
      assignments.push(route.request().postDataJSON());
      data = { success: true, reassigned_count: 1, skipped_completed_count: 0, message: 'Reassigned 1 pending record to Rajesh Kumar.' };
    } else if (url.pathname.endsWith('/admin/records')) data = { records: [record], total: 1, page: 1, page_size: 50 };
    else if (url.pathname.endsWith('/admin/records/101')) data = record;
    else { await route.fulfill({ status: 403, json: { detail: 'Unavailable in isolated fixture' } }); return; }
    await route.fulfill({ json: data });
  });
  return assignments;
}

test('inspection overview, stat cards and workload links on desktop and mobile', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Inspection Overview' })).toBeVisible();
  await expect(page.locator('.overview-date')).toContainText(/20\d\d/);
  await expect(page.locator('.overview-updated')).toContainText(/Last updated \d{1,2}:\d{2}:\d{2}/);
  await expect(page.getByRole('heading', { name: /Operator Workload/ })).toBeVisible();
  await expect(page.getByText('Recent Records', { exact: true })).toHaveCount(0);
  await expect(page.locator('.audit-metric')).toHaveCount(10);
  await expect(page.locator('.audit-metric-label', { hasText: 'Construction: Yes' })).toBeVisible();
  await expect(page.locator('.audit-metric-label', { hasText: 'Mobile Numbers' })).toBeVisible();
  await expect(page.locator('.progress-track .progress-fill')).toBeVisible();
  await expect(page.getByText('17 completed')).toBeVisible();
  await expect(page.getByText('9 pending')).toBeVisible();
  expect((await page.locator('.audit-metrics').boundingBox())!.height).toBeLessThan(560);
  await expect(page.getByRole('columnheader', { name: 'Operator', exact: true })).toBeVisible();
  await page.screenshot({ path: '../outputs/dashboard-modern-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: /Operator Workload/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.audit-metrics')!).gridTemplateColumns.split(' ').length)).toBe(2);
  await page.screenshot({ path: '../outputs/dashboard-modern-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '6 pending records for Prabhu' }).click();
  await expect(page).toHaveURL(/status=NOT_COMPLETED&user_id=7|user_id=7&status=NOT_COMPLETED/);
  await expect(page.getByRole('button', { name: 'Filter by user' })).toContainText('Prabhu');
});

test('manager views and reassigns records with no admin controls', async ({ page }) => {
  const assignments = await fixture(page, 'MANAGER');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page).toHaveURL(/\/records$/);
  await expect(page.locator('.fos-nav a')).toHaveCount(1);
  await expect(page.getByText('Export Report (Excel)', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Import (Excel)', { exact: true })).toHaveCount(0);
  const headers = page.locator('.records-table thead th');
  await expect(headers.nth(1)).toContainText('Assigned Date');
  await expect(headers.nth(2)).toContainText('Captured At');
  await expect(page.locator('.rec-assigned-at')).not.toContainText(/AM|PM|\d:\d/);
  await expect(page.locator('.rec-captured-time')).toContainText(/\d{2}:\d{2}/);
  await page.getByRole('checkbox', { name: 'Select record CBE-110291-770091' }).check();
  await expect(page.getByRole('button', { name: /Delete selected/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reassign pending records to operator' }).click();
  await page.getByRole('option', { name: 'Rajesh Kumar', exact: true }).click();
  await page.getByRole('button', { name: 'Reassign pending', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Reassigned 1');
  expect(assignments).toEqual([{ record_ids: [101], target_user_id: 8 }]);
  await page.screenshot({ path: '../outputs/manager-records.png', fullPage: true });
  await page.goto('/records/101');
  await expect(page.getByRole('heading', { name: 'Site inspection', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Download/ })).toHaveCount(0);
  for (const path of ['/users', '/records/import', '/records/import-previous', '/logs', '/map']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/records$/);
  }
});
