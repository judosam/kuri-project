import { test, expect, type Page } from '@playwright/test';

// Narrow-viewport regressions found by playtesting: content that used to sit
// off the right edge (or on top of other content) on a phone-sized window.

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@system.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

async function signIn(page: Page) {
  await page.goto('/');
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });
}

/** Every element must fit inside the viewport it is painted into. */
async function rectsWithinViewport(page: Page, selector: string) {
  return page.$$eval(selector, (nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { label: (n as HTMLElement).innerText.trim(), left: Math.round(r.left), right: Math.round(r.right) };
    })
  );
}

test.describe('Mobile navigation', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('all five tabs fit inside the viewport', async ({ page }) => {
    await signIn(page);
    const items = await rectsWithinViewport(page, '.admin-mobile-nav-item');
    expect(items.length).toBe(5);
    for (const item of items) {
      expect(item.right, `${item.label} overflows the viewport`).toBeLessThanOrEqual(360);
      expect(item.left).toBeGreaterThanOrEqual(0);
    }
    // No horizontal page scroll either.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Records toolbar', () => {
  test.use({ viewport: { width: 414, height: 896 } });

  test('filter controls stay inside the content column', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Records' }).click();
    await expect(page.locator('.records-table tbody tr').first()).toBeVisible({ timeout: 15000 });

    const fits = await page.evaluate(() => {
      const group = document.querySelector<HTMLElement>('.toolbar-inline-group');
      const row = document.querySelector<HTMLElement>('.toolbar-row-main');
      if (!group || !row) return { ok: false, reason: 'toolbar not found' };
      return {
        ok: group.getBoundingClientRect().right <= row.getBoundingClientRect().right + 1,
        reason: `group right=${Math.round(group.getBoundingClientRect().right)} row right=${Math.round(
          row.getBoundingClientRect().right
        )}`,
      };
    });
    expect(fits.ok, fits.reason).toBe(true);
  });
});

test.describe('Record detail topbar', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the return button and the actions never overlap', async ({ page }) => {
    await signIn(page);
    await page.goto('/records');
    await expect(page.locator('.records-table tbody tr').first()).toBeVisible({ timeout: 15000 });
    // Imported rows open a separate page in a new tab, so pick a captured row.
    await page.locator('.records-table tbody tr[data-source="captured"]').first().click();
    await expect(page.locator('.rd-section').first()).toBeVisible({ timeout: 15000 });

    const back = await page.locator('.topbar-back-btn').boundingBox();
    const actions = await page.locator('.topbar-cmd-right').boundingBox();
    expect(back && actions).toBeTruthy();
    // Separate rows: the action group starts below the return button.
    expect(actions!.y).toBeGreaterThanOrEqual(back!.y + back!.height - 1);
  });
});

test.describe('Logs tab strip', () => {
  test.use({ viewport: { width: 414, height: 896 } });

  test('every activity tab is inside the viewport, none hidden off-screen', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Logs' }).click();
    await page.locator('.log-toolbar .seg-btn').first().waitFor({ timeout: 15000 });

    const tabs = await rectsWithinViewport(page, '.log-toolbar .seg-btn');
    expect(tabs.length).toBeGreaterThan(4);
    for (const tab of tabs) {
      expect(tab.left, `${tab.label} starts off-screen`).toBeGreaterThanOrEqual(-1);
      expect(tab.right, `${tab.label} is clipped off-screen`).toBeLessThanOrEqual(415);
    }
  });
});
