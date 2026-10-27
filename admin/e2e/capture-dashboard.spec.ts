import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page, field = false) {
  const requests: URL[] = [];
  await page.addInitScript(({ field }) => {
    localStorage.setItem(field ? 'photocapture_user_token' : 'token', 'ui-fixture');
    localStorage.setItem('pc_active_screen', 'dashboard');
  }, { field });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); requests.push(url);
    let data: unknown;
    const record = { id: 101, user_id: 7, user_name: 'Prabhu', name: 'Uploaded inspection', status: 'COMPLETED',
      created_at: '2026-09-20T08:00:00Z', assigned_at: '2026-09-20T08:00:00Z', field_latitude: 11.03, field_longitude: 77.01,
      formatted_address: '23 Field Street', admin_formatted_address: 'Admin site', images: [{ id: 1, photo_order: 1, source: 'uploaded', latitude: 0, longitude: 0, captured_at: '2026-09-24T04:52:29Z' }] };
    if (url.pathname.endsWith('/auth/me')) data = { id: 7, full_name: 'Prabhu', email: 'field@example.com', role: field ? 'FIELD_VERIFIER' : 'ADMIN', is_active: true };
    else if (url.pathname.endsWith('/dashboard')) data = {
      total_records: 26, total_completed_records: 17, manually_added_records: 3, pending_records: 9, total_photos: 16, total_users: 6,
      today_records: 3, month_records: 26, today_completed_records: 3, construction_yes_records: 8, mobile_numbers_collected: 12, completion_rate: 65.4,
      inspector_stats: [{ user_id: 7, user_name: 'New Field Verifier', email: 'field@example.com', role: 'FIELD_VERIFIER', total_assigned: 26, completed: 17, pending: 9, today_completed: 3, completion_rate: 65.4 }], recent_records: [], daily_activity: [
        { date: '2026-09-22', completed: 3, pending: 1, construction_yes: 2 },
        { date: '2026-09-23', completed: 6, pending: 0, construction_yes: 4 },
        { date: '2026-09-24', completed: 2, pending: 1, construction_yes: 2 },
      ],
    };
    else if (url.pathname.endsWith('/users')) data = { users: [], total: 0 };
    else if (url.pathname.endsWith('/auditors') || url.pathname.endsWith('/assignment-operators')) data = [];
    else if (url.pathname.endsWith('/records/101')) data = record;
    else if (url.pathname.endsWith('/records')) data = { records: field ? [{ ...record, images: [],
      status: url.searchParams.get('status') === 'NOT_COMPLETED' ? 'NOT_COMPLETED' : 'COMPLETED',
      field_captured_at: url.searchParams.get('status') === 'NOT_COMPLETED' ? null : '2026-09-24T04:52:29Z',
      assigned_at: '2025-01-01T00:00:00Z' }] : [], total: field ? 1 : 0, page: 1, page_size: 15 };
    else { await route.fulfill({ status: 200, json: {} }); return; }
    await route.fulfill({ json: data });
  });
  return requests;
}

test('admin filters retain status and show daily charts plus uploaded field coordinates', async ({ page }) => {
  const requests = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Day-wise activity' })).toBeVisible();
  await expect(page.getByText('Mobile Numbers', { exact: true })).toBeVisible();
  await expect(page.locator('.audit-metric')).toHaveCount(6);
  await expect(page.locator('.audit-metric').filter({ hasText: 'Manually Added' }).locator('strong')).toHaveText('3');
  await expect(page.getByRole('link', { name: 'Audit Review', exact: true })).toHaveCount(0);
  await expect(page.getByText('Total Completed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Field Verifier', exact: true })).toBeVisible();
  for (const label of ['This Month', 'Activity Today', 'Users', 'Photos', 'Completed Today']) {
    await expect(page.locator('.audit-metrics').getByText(label, { exact: true })).toHaveCount(0);
  }
  const dateBox = await page.getByRole('group', { name: 'Capture date range' }).boundingBox();
  const statusBox = await page.getByRole('group', { name: 'Quick status' }).boundingBox();
  expect(Math.abs(dateBox!.y - statusBox!.y)).toBeLessThan(5);
  await page.getByRole('group', { name: 'Capture date range' }).getByRole('button', { name: 'Yesterday', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.pathname.endsWith('/dashboard')).at(-1)?.searchParams.get('date_from')).toMatch(/\+05:30$/);
  await page.getByRole('group', { name: 'Quick status' }).getByRole('button', { name: 'Completed', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.pathname.endsWith('/dashboard')).at(-1)?.searchParams.get('status')).toBe('COMPLETED');
  await expect(page.getByRole('button', { name: 'Yesterday', exact: true })).toHaveClass(/active/);
  await page.getByRole('group', { name: 'Chart metric' }).getByRole('button', { name: 'Construction: Yes' }).click();
  await expect(page.locator('.daily-chart-summary strong')).toHaveText('8');
  await page.screenshot({ path: '../outputs/admin-capture-dashboard.png', fullPage: true });
  await page.screenshot({ path: '../outputs/admin-daily-chart.png', animations: 'disabled' });
  await page.goto('/records');
  await expect(page.locator('.records-toolbar')).toBeVisible();
  expect((await page.locator('.records-toolbar').boundingBox())!.height).toBeLessThan(205);
  await expect(page.getByRole('button', { name: 'Filter by status', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '../outputs/compact-record-filters.png', animations: 'disabled' });
  await expect(page.getByRole('button', { name: 'Completed today', exact: true })).toHaveCount(0);
  await page.getByRole('group', { name: 'Date preset' }).getByRole('button', { name: 'Yesterday' }).click();
  await page.getByRole('group', { name: 'Quick status' }).getByRole('button', { name: 'Pending' }).click();
  await expect.poll(() => requests.filter(r => r.pathname.endsWith('/records')).at(-1)?.searchParams.get('date_field')).toBe('assigned_at');
  await expect(page.getByRole('group', { name: 'Date preset' }).getByRole('button', { name: 'Yesterday' })).toHaveClass(/active/);
  await page.getByRole('group', { name: 'Quick status' }).getByRole('button', { name: 'Completed' }).click();
  await expect.poll(() => requests.filter(r => r.pathname.endsWith('/records')).at(-1)?.searchParams.get('date_field')).toBe('captured_at');
  await page.goto('/records/101', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('23 Field Street', { exact: true })).toBeVisible();
  await expect(page.locator('.rd-coord-item').filter({ hasText: 'Field Captured Coordinates' })).toContainText('11.030000, 77.010000');
  await expect(page.getByText('23 Field Street', { exact: true })).toBeVisible();
});

test('records contains full planning, inspection and audit fields; manager mutations are hidden', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/admin/records?*', route => route.fulfill({ json: { total: 1, records: [{ id: 101, user_id: 7, name: 'Complete field record', status: 'COMPLETED', audit_status: 'APPROVAL', created_at: '2026-09-27T06:00:00Z', images: [], survey_no: '47B', contact_number: '9876543210', qc_vhr_comment: 'Construction verified', qc_builder_contact: 'Builder details', audit_comment: 'Site checked', is_manually_added: false }] } }));
  await page.goto('/audit');
  await expect(page).toHaveURL(/\/records$/);
  await expect(page.getByRole('button', { name: 'All details', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Survey No', 'Contact Number', 'QC Builder / Contact', 'Audit Comment', 'Field Inspection Address']) {
    await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('cell', { name: '9876543210', exact: true })).toBeVisible();
  await page.screenshot({ path: '../outputs/workflow-records-all-fields.png', animations: 'disabled' });
  await page.route('**/api/auth/me', route => route.fulfill({ json: { id: 9, full_name: 'Manager', role: 'MANAGER', is_active: true } }));
  await page.goto('/records/101', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('23 Field Street', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download Full Record (.xlsx)', exact: true })).toHaveCount(0);
});

test('settings contains users with protected deletion and mobile layout', async ({ page }) => {
  await fixture(page);
  let deleted = false;
  let blockDelete = true;
  let deleteRequests = 0;
  await page.route('**/api/admin/users**', async route => {
    if (route.request().method() === 'DELETE') {
      deleteRequests++;
      if (blockDelete) return route.fulfill({ status: 409, json: { detail: 'This user has inspection records. Deactivate the account to preserve history.' } });
      deleted = true;
      return route.fulfill({ status: 204 });
    }
    await route.fulfill({ json: { users: deleted ? [] : [{ id: 8, full_name: 'Test Operator', email: 'operator@example.com', role: 'USER', is_active: true, created_at: '2026-09-24T05:00:00Z' }], total: deleted ? 0 : 1 } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/users');
  await expect(page).toHaveURL(/\/settings\/users$/);
  await expect(page.getByRole('link', { name: 'Settings', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete Test Operator', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete user?' });
  await expect(dialog).toBeVisible();
  expect(deleteRequests).toBe(0);
  await dialog.getByRole('button', { name: 'Delete user', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('inspection records');
  await page.screenshot({ path: '../outputs/settings-delete-user.png' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  blockDelete = false;
  await page.getByRole('button', { name: 'Delete Test Operator', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete user', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('No users found.', { exact: true })).toBeVisible();
  expect(deleteRequests).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Day-wise activity' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.goto('/records');
  await expect(page.locator('.records-toolbar')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('field keeps original status tabs and capture filters on dashboard and records', async ({ page }) => {
  const requests = await fixture(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5188/app/');
  await expect(page.locator('.stat-card').filter({ hasText: 'Manually Added' }).locator('.stat-card-val')).toHaveText('3');
  await expect(page.locator('.stat-card').filter({ hasText: 'Total Completed' }).locator('.stat-card-val')).toHaveText('17');
  await expect(page.getByRole('heading', { name: 'Day-wise activity' })).toBeVisible();
  await expect(page.getByText('Quick range:', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Yesterday', exact: true }).click();
  await page.getByRole('tab', { name: 'Completed', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.pathname.endsWith('/dashboard')).at(-1)?.searchParams.get('status')).toBe('COMPLETED');
  const query = requests.filter(r => r.pathname.endsWith('/dashboard')).at(-1)!;
  expect(query.searchParams.get('date_from')).toMatch(/\+05:30$/);
  await page.getByRole('group', { name: 'Chart metric' }).getByRole('button', { name: 'Construction: Yes' }).click();
  await expect(page.locator('.daily-chart-summary strong')).toHaveText('8');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: '../outputs/field-capture-dashboard.png', fullPage: true });
  await page.locator('.daily-chart').screenshot({ path: '../outputs/field-daily-chart.png' });
  await page.getByRole('button', { name: /Tasks & Records/ }).click();
  await page.getByRole('button', { name: /Yesterday$/ }).click();
  await page.getByRole('tab', { name: 'Completed', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.pathname.endsWith('/records')).at(-1)?.searchParams.get('status')).toBe('COMPLETED');
  await expect.poll(() => requests.filter(r => r.pathname.endsWith('/records')).at(-1)?.searchParams.get('date_field')).toBe('captured_at');
  await expect(page.getByText(/Inspection completed:/).first()).toBeVisible();
  await expect(page.getByText(/Assigned:|Assigned 1 Jan/)).toHaveCount(0);
  await page.getByRole('tab', { name: 'Pending', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.pathname.endsWith('/records')).at(-1)?.searchParams.get('date_field')).toBe('assigned_at');
  await expect(page.getByText('Not inspected yet', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Quick range:', { exact: true })).toHaveCount(0);
});


const workflowRecord = {
  id: 101, unique_id: 'WORKFLOW-101', name: 'Workflow site', user_id: 7, user_name: 'Field verifier',
  status: 'COMPLETED', audit_status: 'APPROVAL', images: [],
  created_at: '2026-09-27T06:00:00Z', assigned_at: '2026-09-27T07:00:00Z',
  uploaded_by_name: 'Task importer', staged_operator_name: 'Suggested verifier', survey_no: '47B', survey_number: '47C', subdivision_no: '1A',
  street_address: 'Imported street', assigned_auditor_name: 'Assigned auditor', audited_by_name: 'Review auditor',
  audited_at: '2026-09-27T06:30:00Z', audit_comment: 'Audit trail comment', qc_builder_contact: 'Builder 123', qc_street_details: 'Road verified', qc_vhr_comment: 'Cleared site',
  field_captured_at: '2026-09-27T08:00:00Z', formatted_address: 'Captured street', field_latitude: 11.04, field_longitude: 77.03,
  contact_number: '9876543210', remarks: 'Field remarks', construction_happening: 'Yes', relationship_with_building: 'Owner',
};

for (const role of ['ADMIN', 'TASK_IMPORTER', 'AUDITOR']) {
  test(`${role} records show all workflow stages and preserve queue dates`, async ({ page }) => {
    const requests = await fixture(page);
    await page.route('**/api/auth/me', route => route.fulfill({ json: { id: 9, full_name: role, role, is_active: true } }));
    await page.route('**/api/admin/records?*', route => {
      requests.push(new URL(route.request().url()));
      return route.fulfill({ json: { total: 1, records: [workflowRecord] } });
    });
    await page.goto('/records');
    const views = page.getByRole('group', { name: 'Record details view' });
    await views.getByRole('button', { name: 'All details', exact: true }).click();
    for (const name of ['Imported By', 'Audit Comment', 'Field Inspection Address', 'Inspection Remarks', 'Suggested Field Verifier']) {
      await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('cell', { name: '47C', exact: true })).toBeVisible();
    await views.getByRole('button', { name: 'Audit Details', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Audit trail comment', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Contact Number', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Audited By', exact: true }).click();
    await expect.poll(() => requests.filter(r => r.pathname.endsWith('/records')).at(-1)?.searchParams.get('sort_by')).toBe('audited_by');
    await views.getByRole('button', { name: 'Field Verification', exact: true }).click();
    await expect(page.getByRole('cell', { name: '11.040000, 77.030000', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Field remarks', exact: true })).toBeVisible();
    await page.screenshot({ path: `../outputs/${role.toLowerCase()}-record-stages.png`, animations: 'disabled' });
    await page.getByRole('group', { name: 'Date preset' }).getByRole('button', { name: 'Today', exact: true }).click();
    await expect.poll(() => requests.filter(r => r.pathname.endsWith('/records')).at(-1)?.searchParams.get('date_field')).toBe(role === 'ADMIN' ? 'captured_at' : 'created_at');
    if (role === 'AUDITOR') {
      await page.getByRole('cell', { name: 'WORKFLOW-101', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Imported Details', exact: true })).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Audit Details', exact: true })).toBeVisible();
      await expect(dialog.getByText('Field remarks', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Audit trail comment', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
}

test('auditor popup saves the audit comment and reports approval as awaiting assignment', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/auth/me', route => route.fulfill({ json: { id: 9, full_name: 'Auditor', role: 'AUDITOR', is_active: true } }));
  const pending = { ...workflowRecord, user_id: null, user_name: null, status: 'NOT_COMPLETED', audit_status: 'APPROVAL', field_captured_at: null };
  await page.route('**/api/admin/records?*', route => route.fulfill({ json: { total: 1, records: [pending] } }));
  let saved: any;
  await page.route('**/api/admin/records/101/audit', route => { saved = route.request().postDataJSON(); return route.fulfill({ json: { ...pending, ...saved } }); });
  await page.goto('/records');
  await page.getByRole('cell', { name: 'WORKFLOW-101', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Audit Comment', { exact: true }).fill('Checked access road');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => saved?.audit_comment).toBe('Checked access road');
  await expect(page.getByText(/approved; ready for verifier assignment/)).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('record load failure shows a retry instead of an empty result', async ({ page }) => {
  await fixture(page);
  let fail = true;
  await page.route('**/api/admin/records?*', route => fail ? route.fulfill({ status: 503, json: { detail: 'Records temporarily unavailable' } }) : route.fulfill({ json: { total: 1, records: [workflowRecord] } }));
  await page.goto('/records');
  await expect(page.getByRole('alert')).toContainText('Records temporarily unavailable');
  await expect(page.getByText(/No records found/)).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'WORKFLOW-101', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
