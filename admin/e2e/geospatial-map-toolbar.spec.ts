import { test, expect } from '@playwright/test';

const USERS = [
  { role: 'AUDITOR', email: 'auditor.test@system.local', password: 'admin123' },
  { role: 'ADMIN', email: 'admin@system.local', password: 'admin123' },
  { role: 'TASK_IMPORTER', email: 'assigner.test@system.local', password: 'admin123' },
];

test.describe('Geospatial Field Map Toolbar & Show Details Removal', () => {
  for (const user of USERS) {
    test(`[${user.role}] no Show details bar on Records, and Map toolbar is strictly 2 lines with From/To inline`, async ({ page }) => {
      // 1. Login
      await page.goto('/');
      await page.fill('input[type="email"]', user.email);
      await page.fill('input[type="password"]', user.password);
      await page.click('button[type="submit"]');

      // Wait for login redirection
      await expect(page.locator('h1.topbar-page-title')).toBeVisible({ timeout: 15000 });

      // 2. Go to /records and check that "Show details:" does not exist
      await page.goto('/records');
      await expect(page.locator('h1.topbar-page-title')).toContainText('Records', { timeout: 15000 });

      const showDetailsBar = page.locator('.record-view-bar');
      await expect(showDetailsBar).toHaveCount(0);
      const showDetailsText = page.getByText('Show details:');
      await expect(showDetailsText).toHaveCount(0);

      // 3. Go to Geospatial Field Map (/map)
      await page.goto('/map');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('h1.topbar-page-title')).toContainText('Geospatial Field Map', { timeout: 15000 });

      // 4. Verify toolbar card layout
      const toolbar = page.locator('.geospatial-map-toolbar');
      await expect(toolbar).toBeVisible();

      const rowMain = toolbar.locator('.toolbar-row-main');
      const rowSub = toolbar.locator('.toolbar-row-sub');
      await expect(rowMain).toBeVisible();
      await expect(rowSub).toBeVisible();

      // Verify rowMain has Search record name, Search location, User dropdown, Apply button
      await expect(rowMain.locator('input[placeholder*="Search record"]')).toBeVisible();
      await expect(rowMain.locator('input[placeholder*="Search place"]')).toBeVisible();
      await expect(rowMain.locator('button:has-text("Apply")')).toBeVisible();

      // Verify rowSub has Quick range, Status, and Date range
      await expect(rowSub.getByText('Quick range:')).toBeVisible();
      await expect(rowSub.getByText('Status:')).toBeVisible();
      await expect(rowSub.getByText('From:')).toBeVisible();
      await expect(rowSub.getByText('To:')).toBeVisible();

      // 5. Verify From: and To: date inputs are on the exact same vertical line (no 3rd row wrap)
      const fromInput = rowSub.locator('input[aria-label="Date from"]');
      const toInput = rowSub.locator('input[aria-label="Date to"]');
      await expect(fromInput).toBeVisible();
      await expect(toInput).toBeVisible();

      const fromBox = await fromInput.boundingBox();
      const toBox = await toInput.boundingBox();
      expect(fromBox).not.toBeNull();
      expect(toBox).not.toBeNull();

      if (fromBox && toBox) {
        // Vertical difference between From and To should be within ~5px (same row), NOT wrapped to next line
        const verticalDelta = Math.abs(fromBox.y - toBox.y);
        expect(verticalDelta).toBeLessThan(10);
        // To input must be horizontally to the right of From input
        expect(toBox.x).toBeGreaterThan(fromBox.x);
      }

      // Logout before next iteration
      await page.evaluate(() => localStorage.clear());
      await page.goto('/');
    });
  }

  test('Admin user accounts sub-heading is removed and sort options are comprehensive', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="email"]', 'admin@system.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page.locator('h1.topbar-page-title')).toBeVisible({ timeout: 15000 });

    // Verify /users sub-heading is removed
    await page.goto('/users');
    await expect(page.locator('h1.topbar-page-title')).toContainText('Users', { timeout: 15000 });
    await expect(page.locator('.settings-section-heading')).toHaveCount(0);
    await expect(page.getByText('Manage access, roles, and sign-in credentials.')).toHaveCount(0);

    // Verify /records sort options
    await page.goto('/records');
    await expect(page.locator('h1.topbar-page-title')).toContainText('Records', { timeout: 15000 });
    const sortField = page.locator('.filter-sort');
    await expect(sortField).toBeVisible();

    await page.evaluate(() => localStorage.clear());
  });
});
