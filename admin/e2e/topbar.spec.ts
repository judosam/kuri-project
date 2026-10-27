import { test, expect, type Page } from '@playwright/test';

// The unified topbar is shared by every page: a title on the left and the
// page's own actions on the right. At narrow widths the action labels collapse
// to icons — the icons themselves must never disappear.

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@system.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

async function signIn(page: Page) {
  await page.goto('/');
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });
}

async function openRecords(page: Page) {
  await signIn(page);
  await page.getByRole('link', { name: 'Records' }).click();
  await expect(page.locator('.records-table tbody tr').first()).toBeVisible({ timeout: 15000 });
}

/** Geometry + visibility of the title and the action buttons in the topbar. */
async function readTopbar(page: Page) {
  return page.evaluate(() => {
    const topbar = document.querySelector('.fos-topbar')!;
    const title = document.querySelector('.topbar-page-title') as HTMLElement;
    const buttons = Array.from(document.querySelectorAll('.topbar-right .btn'));
    const icons = Array.from(document.querySelectorAll('.topbar-right .btn .ms'));
    const labels = Array.from(document.querySelectorAll('.topbar-right .btn .btn-label'));
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const titleRect = title.getBoundingClientRect();
    // The title is clipped by the bar (overflow hidden), so compare its scroll
    // height to its box to detect wrapped-and-cut-off lines.
    return {
      lineHeightPx: parseFloat(getComputedStyle(title).lineHeight),
      titleHeight: titleRect.height,
      titleRight: titleRect.right,
      firstButtonLeft: buttons.length ? buttons[0].getBoundingClientRect().left : Infinity,
      buttonCount: buttons.length,
      iconsVisible: icons.filter(visible).length,
      labelsVisible: labels.filter(visible).length,
      topbarRight: topbar.getBoundingClientRect().right,
      titleInsideBar: titleRect.right <= topbar.getBoundingClientRect().right + 1,
      titleLines: Math.round(titleRect.height / parseFloat(getComputedStyle(title).lineHeight)),
    };
  });
}

test.describe('Topbar', () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await openRecords(page);
  });

  test('keeps every action icon visible when the labels collapse', async ({ page }) => {
    const bar = await readTopbar(page);

    // Every Records action is present…
    expect(bar.buttonCount).toBe(4); // import previous records, export, template, import (sync pill is not a .btn)
    // …each still shows its Material icon…
    expect(bar.iconsVisible).toBe(4);
    // …with the text labels hidden to make room.
    expect(bar.labelsVisible).toBe(0);
  });

  test('does not wrap or clip the page title', async ({ page }) => {
    const bar = await readTopbar(page);
    expect(bar.titleLines).toBe(1);
    expect(bar.titleInsideBar).toBe(true);
  });

  test('never lets the title and actions overlap', async ({ page }) => {
    const bar = await readTopbar(page);
    expect(bar.titleRight).toBeLessThanOrEqual(bar.firstButtonLeft);
  });
});

test.describe('Topbar — wide viewport', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('shows the action labels alongside the icons', async ({ page }) => {
    await openRecords(page);
    const bar = await readTopbar(page);
    expect(bar.labelsVisible).toBe(4);
    expect(bar.iconsVisible).toBe(4);
    expect(bar.titleLines).toBe(1);
    expect(bar.titleRight).toBeLessThanOrEqual(bar.firstButtonLeft);
  });
});

test.describe('Records date range', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('opens on All time so nothing is silently filtered out', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Records' }).click();
    await expect(page.locator('.records-table tbody tr').first()).toBeVisible({ timeout: 15000 });

    const active = page.locator('.field-range .seg-btn.active');
    await expect(active).toHaveText('All time');
    await expect(page.locator('.fld-date-input').first()).toHaveValue('');
  });

  test('All time is the first option in the quick range', async ({ page }) => {
    await openRecords(page);
    await expect(page.locator('.field-range .seg-btn').first()).toHaveText('All time');
  });
});
