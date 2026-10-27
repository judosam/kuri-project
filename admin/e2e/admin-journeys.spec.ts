import { test, expect, type Page } from '@playwright/test';

// These tests require a running backend API and the admin panel at http://localhost:5173.
// Selectors are role-based so they stay robust against icon fonts and breadcrumb chrome.

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@system.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

async function signIn(page: Page) {
  await page.goto('/');
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  // The API rate-limits to 10 logins/min per IP and this suite signs in once per
  // test, so the tail tests can trip it. Wait out the sliding window and retry.
  const rateLimited = page.getByText('Too many login attempts');
  for (let i = 0; i < 6 && (await rateLimited.isVisible().catch(() => false)); i++) {
    await page.waitForTimeout(15000);
    await page.click('button[type="submit"]');
  }
  await expectPageTitle(page, 'Dashboard');
}

/** The page title lives in the top bar and is unique per route. */
async function expectPageTitle(page: Page, title: string | RegExp) {
  await expect(page.locator('h1.topbar-page-title')).toHaveText(title, { timeout: 15000 });
}

test.describe('Admin Panel E2E', () => {
  test.describe('Authentication', () => {
    test('shows login page when not authenticated', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('input[type="password"]')).toBeVisible();
    });

    test('shows error for invalid credentials', async ({ page }) => {
      await page.goto('/');
      await page.fill('input[type="email"]', 'wrong@example.com');
      await page.fill('input[type="password"]', 'wrongpass');
      await page.click('button[type="submit"]');
      await expect(page.getByText('Invalid email or password')).toBeVisible();
    });

    test('logs in successfully with valid credentials', async ({ page }) => {
      await signIn(page);
    });
  });

  test.describe('Dashboard', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page);
    });

    test('displays metric cards', async ({ page }) => {
      await expect(page.getByText('Total Records', { exact: true })).toBeVisible();
      await expect(page.getByText('Pending Inspections', { exact: true })).toBeVisible();
      await expect(page.getByText('Users', { exact: true })).toBeVisible();
    });

    test('displays progress summary', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'Progress Summary' })).toBeVisible();
      await expect(page.locator('.progress-track .progress-fill')).toBeVisible();
    });
  });

  test.describe('User Management', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page);
      await page.getByRole('link', { name: 'Settings' }).click();
      await expectPageTitle(page, /User Accounts|Settings/);
    });

    test('displays user list', async ({ page }) => {
      // The signed-in account also appears in the sidebar, so scope to the table.
      await expect(page.getByRole('table').getByText(ADMIN_EMAIL).first()).toBeVisible();
    });

    test('can create a new user', async ({ page }) => {
      const stamp = Date.now();
      const name = `Test Field User ${stamp}`;
      const email = `testuser_${stamp}@example.com`;

      await page.getByRole('button', { name: '+ Create Account' }).click();
      await page.fill('input[placeholder="Full Name"]', name);
      await page.fill('input[placeholder="Email"]', email);
      await page.getByRole('button', { name: 'Create Account' }).click();

      await expect(page.getByText('Account Created Successfully')).toBeVisible({ timeout: 10000 });
      // The new account appears both in the confirmation dialog and the refreshed table.
      await expect(page.getByText(email).first()).toBeVisible();
    });
  });

  test.describe('Records', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page);
      await page.getByRole('link', { name: 'Records' }).click();
      await expectPageTitle(page, 'Field Records & Tasks');
    });

    test('displays records page', async ({ page }) => {
      await expect(page.locator('.records-toolbar')).toBeVisible();
      // Default range is "This week"; widen it so the table renders regardless of the date.
      await page.getByRole('button', { name: 'All time' }).click();
      await expect(page.locator('.records-table')).toBeVisible({ timeout: 15000 });
    });

    test('has search functionality', async ({ page }) => {
      await expect(
        page.locator('input[placeholder="Search by UID, site address, survey no, owner, or operator…"]')
      ).toBeVisible();
    });

    test('has date filters', async ({ page }) => {
      await page.locator('.records-date-options summary').click();
      await expect(page.locator('input[type="date"]').first()).toBeVisible();
    });
  });

  test.describe('Map', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page);
      await page.getByRole('link', { name: 'Map' }).click();
      await expectPageTitle(page, 'Geospatial Field Map');
    });

    test('displays map page', async ({ page }) => {
      await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Navigation', () => {
    test('can navigate between all sections', async ({ page }) => {
      await signIn(page);

      await page.getByRole('link', { name: 'Settings' }).click();
      await expectPageTitle(page, /User Accounts|Settings/);

      await page.getByRole('link', { name: 'Records' }).click();
      await expectPageTitle(page, 'Field Records & Tasks');

      await page.getByRole('link', { name: 'Map' }).click();
      await expectPageTitle(page, 'Geospatial Field Map');

      await page.getByRole('link', { name: 'Logs' }).click();
      await expectPageTitle(page, 'Activity Logs');

      await page.getByRole('link', { name: 'Dashboard' }).click();
      await expectPageTitle(page, 'Dashboard');
    });

    test('can logout', async ({ page }) => {
      await signIn(page);
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({ timeout: 10000 });
    });
  });
});
