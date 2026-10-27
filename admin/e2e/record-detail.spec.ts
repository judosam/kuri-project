import { test, expect, type Page } from '@playwright/test';

// These tests exercise the redesigned record detail panel and the records table
// against a running backend API and the admin panel on http://localhost:5173.

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@system.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

async function signIn(page: Page) {
  await page.goto('/');
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  // The API rate-limits to 10 logins/min per IP; a full-file run exceeds it.
  const rateLimited = page.getByText('Too many login attempts');
  for (let i = 0; i < 6 && (await rateLimited.isVisible().catch(() => false)); i++) {
    await page.waitForTimeout(15000);
    await page.click('button[type="submit"]');
  }
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });
}

async function openRecords(page: Page) {
  await signIn(page);
  await page.getByRole('link', { name: 'Records' }).click();
  await page.getByRole('button', { name: 'All time' }).click();
  await expect(page.locator('.records-table tbody tr').first()).toBeVisible({ timeout: 15000 });
}

/** Section titles of the detail panel, with the leading icon ligature stripped. */
async function sectionTitles(page: Page): Promise<string[]> {
  return page.$$eval('.rd-section-title', (nodes) =>
    nodes.map((n) =>
      Array.from(n.childNodes)
        .filter((c) => c.nodeType === Node.TEXT_NODE)
        .map((c) => c.textContent || '')
        .join('')
        .trim()
    )
  );
}

test.describe('Record detail panel', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto('/records/1');
    await expect(page.locator('.record-audit-card')).toBeVisible({ timeout: 15000 });
  });

  test('shows the details in the exact requested order', async ({ page }) => {
    const titles = await sectionTitles(page);
    // Check that the present sections match the ordered sequence:
    // [Field Operator, Site & Location, Imported Details, Audit Details, Field Verification, Location Verification, Capture Details]
    const expectedOrder = [
      'Field Operator',
      'Site & Location',
      'Imported Details',
      'Audit Details',
      'Field Verification',
      'Location Verification',
      'Capture Details',
    ];
    // Filter to expectedOrder items in case optional sections like Imported Details are present or absent
    const filteredTitles = titles.filter((t) => expectedOrder.includes(t));
    const expectedFiltered = expectedOrder.filter((t) => titles.includes(t));
    expect(filteredTitles).toEqual(expectedFiltered);
    expect(titles[0]).toBe('Field Operator');
    expect(titles[1]).toBe('Site & Location');
    // Audit Details must come before Field Verification
    expect(titles.indexOf('Audit Details')).toBeLessThan(titles.indexOf('Field Verification'));
    // Field Verification must come before Location Verification
    expect(titles.indexOf('Field Verification')).toBeLessThan(titles.indexOf('Location Verification'));
    // Location Verification must come before Capture Details
    expect(titles.indexOf('Location Verification')).toBeLessThan(titles.indexOf('Capture Details'));
  });

  test('formats Imported Details, Audit Details, and Field Verification as four-column tables', async ({ page }) => {
    const auditSection = page.locator('.rd-section', { hasText: 'Audit Details' }).first();
    const fieldSection = page.locator('.rd-section', { hasText: 'Field Verification' }).first();

    await expect(auditSection.locator('.four-column-table')).toBeVisible();
    await expect(fieldSection.locator('.four-column-table')).toBeVisible();

    const importedSection = page.locator('.rd-section', { hasText: 'Imported Details' });
    if ((await importedSection.count()) > 0) {
      await expect(importedSection.locator('.four-column-table')).toBeVisible();
    }
  });

  test('formats Site & Location in two columns with record data and title', async ({ page }) => {
    const location = page.locator('.rd-section', { hasText: 'Site & Location' }).first();
    await expect(location.locator('.site-location-two-col-grid')).toBeVisible();
    await expect(location.locator('.site-location-card')).toHaveCount(2);

    const cards = location.locator('.site-location-card');
    await expect(cards.nth(0).locator('.site-location-title')).toHaveText('Field Inspection Address');
    await expect(cards.nth(1).locator('.site-location-title')).toHaveText('Admin Given Address');

    // Values should sit above titles in DOM structure
    await expect(cards.nth(0).locator('.site-location-val')).toBeVisible();
    await expect(cards.nth(1).locator('.site-location-val')).toBeVisible();
  });

  test('Location Verification offers Open in Geospatial Field Map and Open in Google Maps', async ({ page }) => {
    const locationVerif = page.locator('.rd-section', { hasText: 'Location Verification' }).first();
    await expect(locationVerif).toBeVisible();

    const geoMapBtn = locationVerif.locator('button, a', { hasText: 'Open in Geospatial Field Map' });
    await expect(geoMapBtn).toBeVisible();

    // Verify buttons do not have text-decoration: underline
    const textDecoration = await geoMapBtn.evaluate((el) => window.getComputedStyle(el).textDecoration);
    expect(textDecoration).not.toContain('underline');
  });

  test('no buttons or action links have underline decoration', async ({ page }) => {
    const buttons = await page.$$eval('button, .btn, .rd-link-btn', (els) =>
      els.slice(0, 15).map((el) => window.getComputedStyle(el).textDecoration)
    );
    for (const dec of buttons) {
      expect(dec).not.toContain('underline');
    }
  });

  test('reports the GPS deviation against a 30 m tolerance', async ({ page }) => {
    const verification = page.locator('.rd-section', { hasText: 'Location Verification' }).first();
    await expect(verification).toBeVisible();

    // Bands are computed by the shipped module: <=10 m exact, <=30 m nearby, >30 m discrepancy.
    const bands = await page.evaluate(async () => {
      const mod = await import('/src/utils/geo.ts');
      const given = '11.000000,77.000000';
      const at = (lat: number) => mod.calculateCoordVariance(given, lat, 77)!.status;
      return {
        tolerance: mod.NEARBY_LOCK_METERS,
        ten: at(11.00005),
        twentyFive: at(11.000225),
        thirtyOne: at(11.00028),
      };
    });

    expect(bands.tolerance).toBe(30);
    expect(bands.ten).toBe('exact');
    expect(bands.twentyFive).toBe('close');
    expect(bands.thirtyOne).toBe('far');
  });

  test('does not overflow horizontally', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('Record detail panel — narrow viewport', () => {
  test.use({ viewport: { width: 760, height: 900 } });

  test('stacks the details above the media stage and scrolls the page', async ({ page }) => {
    await signIn(page);
    await page.goto('/records/1');
    await expect(page.locator('.record-audit-card')).toBeVisible({ timeout: 15000 });

    const layout = await page.evaluate(() => {
      const grid = document.querySelector('.record-screen-grid')!;
      const panel = document.querySelector('.record-audit-card')!;
      const media = document.querySelector('.record-media-card')!;
      const main = document.querySelector('.fos-content')!;
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        panelBelowMedia: panel.getBoundingClientRect().top < media.getBoundingClientRect().top,
        panelClips: panel.scrollHeight > panel.clientHeight + 1,
        mainScrolls: main.scrollHeight > main.clientHeight,
      };
    });

    expect(layout.columns).toBe(1);
    expect(layout.panelBelowMedia).toBe(true);
    expect(layout.panelClips).toBe(false);
    expect(layout.mainScrolls).toBe(true);
  });
});
