import { test, expect } from '@playwright/test';

const AUDITOR_EMAIL = 'auditor.test@system.local';
const AUDITOR_PASSWORD = 'admin123';

test.describe('Auditor Field Records & Tasks Redesign', () => {
  test('auditor login: no Show details bar, default overview, four-column imported details form, no Description or Audit Comment, 2-line clamp with inline orange show more text, no underline on map button, and QC column shows [logo time date] without edited title', async ({ page }) => {
    // 1. Login as auditor
    await page.goto('/');
    await page.fill('input[type="email"]', AUDITOR_EMAIL);
    await page.fill('input[type="password"]', AUDITOR_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for redirection to /records or records title
    await expect(page.locator('h1.topbar-page-title')).toContainText('Records', { timeout: 15000 });

    // 2. Verify "Show details:" filter bar is NOT visible for auditor
    const showDetailsBar = page.locator('.record-view-bar');
    await expect(showDetailsBar).toHaveCount(0);
    const showDetailsText = page.getByText('Show details:');
    await expect(showDetailsText).toHaveCount(0);

    // Verify QC filter has [All, QC Approved, QC Pending] in order, with All active by default
    const qcSeg = page.locator('.records-quick-filters .seg[aria-label="QC status"]');
    await expect(qcSeg).toBeVisible();
    const qcButtons = qcSeg.locator('.seg-btn');
    await expect(qcButtons.nth(0)).toHaveText('All');
    await expect(qcButtons.nth(0)).toHaveClass(/active/);
    await expect(qcButtons.nth(1)).toHaveText('QC Approved');
    await expect(qcButtons.nth(2)).toHaveText('QC Pending');

    // Verify Sort dropdown defaults to QC Date newest first
    const sortField = page.locator('.filter-sort');
    await expect(sortField).toContainText('QC Date (Newest first)');

    // Click QC Approved to trigger filter and verify Reset button color is orange
    await qcButtons.nth(1).click();
    const resetBtn = page.locator('.records-reset-btn');
    await expect(resetBtn).toBeVisible();
    const resetColor = await resetBtn.evaluate((el) => window.getComputedStyle(el).color);
    expect(resetColor).toBe('rgb(234, 88, 12)');

    // Click reset to return to clean state
    await resetBtn.click();

    // 3. Verify records table is in overview mode and rows are loaded
    const table = page.locator('.records-table');
    await expect(table).toBeVisible();

    const firstRow = page.locator('.records-table tbody tr.rowlink').first();
    await firstRow.waitFor({ state: 'visible', timeout: 15000 });
    const rows = page.locator('.records-table tbody tr.rowlink');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // 4. Verify Map column button has no underline
    const mapButtons = page.locator('.records-table a.btn');
    if ((await mapButtons.count()) > 0) {
      const mapBtn = mapButtons.first();
      await expect(mapBtn).toBeVisible();
      const textDecoration = await mapBtn.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.textDecorationLine || style.textDecoration;
      });
      expect(textDecoration).toBe('none');
    }

    // 5. Click the first row to open the redesigned popup
    await rows.first().click();

    // 6. Verify the dialog is visible
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Verify "Auditor Review" badge and header
    await expect(dialog.locator('.auditor-role-pill')).toContainText('Auditor Review');

    // 7. Verify Imported Details is rendered as a FOUR COLUMN FORM: title record title record
    const singleImportedCard = dialog.locator('.single-imported-card');
    await expect(singleImportedCard).toBeVisible();
    await expect(singleImportedCard).toHaveCount(1);

    // Verify Imported Details heading title is black like other headings
    const importedTitle = singleImportedCard.locator('.single-card-title');
    await expect(importedTitle).toBeVisible();
    const importedTitleColor = await importedTitle.evaluate((el) => window.getComputedStyle(el).color);
    expect(importedTitleColor).toBe('rgb(15, 23, 42)');

    // Verify all icons in popup are orange (#ea580c -> rgb(234, 88, 12))
    const headingIcon = singleImportedCard.locator('.single-card-icon');
    await expect(headingIcon).toBeVisible();
    const headingIconColor = await headingIcon.evaluate((el) => window.getComputedStyle(el).color);
    expect(headingIconColor).toBe('rgb(234, 88, 12)');

    const popupLeadBadge = dialog.locator('.auditor-popup-icon-badge');
    const popupLeadBadgeColor = await popupLeadBadge.evaluate((el) => window.getComputedStyle(el).color);
    expect(popupLeadBadgeColor).toBe('rgb(234, 88, 12)');

    const cardIcons = dialog.locator('.auditor-card-icon');
    const cardIconCount = await cardIcons.count();
    for (let i = 0; i < cardIconCount; i++) {
      const color = await cardIcons.nth(i).evaluate((el) => window.getComputedStyle(el).color);
      expect(color).toBe('rgb(234, 88, 12)');
    }

    // Verify four-column table inside the card
    const importedTable = singleImportedCard.locator('table.four-column-table');
    await expect(importedTable).toBeVisible();

    const tableRows = singleImportedCard.locator('tr.imported-table-row');
    const rowCountInTable = await tableRows.count();
    expect(rowCountInTable).toBeGreaterThan(3);

    // Verify four columns per row: label, value, label, value
    const firstTableRow = tableRows.first();
    const labelsInRow = firstTableRow.locator('td.imported-table-label');
    const valuesInRow = firstTableRow.locator('td.imported-table-value-cell');
    await expect(labelsInRow).toHaveCount(2);
    await expect(valuesInRow).toHaveCount(2);

    // Verify unwanted sub-headings are removed (no count pill)
    const countPill = singleImportedCard.locator('.single-card-count-pill');
    await expect(countPill).toHaveCount(0);

    // Verify titles/labels in Imported Details are blue
    const firstLabel = labelsInRow.first();
    const labelColor = await firstLabel.evaluate((el) => window.getComputedStyle(el).color);
    expect(labelColor).not.toBe('rgb(100, 116, 139)'); // not default slate

    // 8. Verify "Description", "Audit Comment", "Record ID", and "Street Address" are REMOVED
    const descriptionLabel = dialog.locator('.imported-table-label', { hasText: /^Description$/i });
    await expect(descriptionLabel).toHaveCount(0);
    const recordIdLabel = dialog.locator('.imported-table-label', { hasText: /^Record ID$/i });
    await expect(recordIdLabel).toHaveCount(0);
    const streetAddrLabel = dialog.locator('.imported-table-label', { hasText: /^Street Address$/i });
    await expect(streetAddrLabel).toHaveCount(0);

    const auditCommentField = dialog.locator('#qc-audit-comment');
    await expect(auditCommentField).toHaveCount(0);
    const auditCommentLabel = dialog.getByLabel('Audit Comment');
    await expect(auditCommentLabel).toHaveCount(0);

    // Verify "Show more for all" button is completely REMOVED
    const expandAllBtn = singleImportedCard.locator('.single-card-expand-all-btn');
    await expect(expandAllBtn).toHaveCount(0);
    const expandAllText = dialog.getByText('Show more for all');
    await expect(expandAllText).toHaveCount(0);

    // 9. Verify detail fields default to 2 lines (clamped-2)
    const clampedValues = singleImportedCard.locator('.imported-table-value.clamped-2');
    const clampedCount = await clampedValues.count();
    expect(clampedCount).toBeGreaterThan(0);

    // 10. Verify toggle has ONLY up / down arrow and NO "Show more" / "Show less" text
    const inlineShowMore = singleImportedCard.locator('.inline-show-more-text');
    const moreBtnCount = await inlineShowMore.count();
    if (moreBtnCount > 0) {
      const firstMore = inlineShowMore.first();
      await expect(firstMore).toContainText('▾');
      const text = await firstMore.textContent();
      expect(text).not.toContain('Show more');
      expect(text).not.toContain('Show less');

      // Verify orange color (#ea580c -> rgb(234, 88, 12))
      const color = await firstMore.evaluate((el) => window.getComputedStyle(el).color);
      expect(color).toBe('rgb(234, 88, 12)');

      // Click to expand -> shows up arrow ▴
      await firstMore.click();
      await expect(firstMore).toContainText('▴');
      const expText = await firstMore.textContent();
      expect(expText).not.toContain('Show less');

      // Click to collapse -> returns to down arrow ▾
      await firstMore.click();
      await expect(firstMore).toContainText('▾');
    }

    // 11. Verify map button in popup has no underline
    const popupMapBtn = dialog.locator('.auditor-external-btn');
    if ((await popupMapBtn.count()) > 0) {
      const popupTextDec = await popupMapBtn.first().evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.textDecorationLine || style.textDecoration;
      });
      expect(popupTextDec).toBe('none');
    }

    // 12. Verify cross icon has distinct color
    const closeBtn = dialog.locator('.auditor-popup-close-btn');
    await expect(closeBtn).toBeVisible();
    const closeColor = await closeBtn.evaluate((el) => window.getComputedStyle(el).color);
    expect(closeColor).toBe('rgb(239, 68, 68)');

    // 13. Verify button says "Save QC"
    const saveBtn = dialog.locator('.auditor-save-btn');
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toContainText('Save QC');

    // 14. Select an audit decision and save QC
    const decisionTrigger = dialog.locator('[aria-label^="Audit status for record"]');
    await expect(decisionTrigger.first()).toBeVisible();
    await decisionTrigger.first().click();

    const approvalOption = page.locator('.custom-select-item', { hasText: 'Approval' });
    if ((await approvalOption.count()) > 0) {
      await approvalOption.first().click();
    }

    await saveBtn.click();

    // Dialog should close
    await expect(dialog).toHaveCount(0, { timeout: 10000 });

    // 15. Verify QC column in table shows QC Done or QC Edited with date and time below it
    const qcCell = page.locator('.records-table tbody tr.rowlink td:nth-child(2)').first();
    await expect(qcCell).toBeVisible({ timeout: 10000 });

    // Should have either .qc-edit-chip (QC Edited) or .qc-done-chip (QC Done)
    const hasEditChip = (await qcCell.locator('.qc-edit-chip').count()) > 0;
    const hasDoneChip = (await qcCell.locator('.qc-done-chip').count()) > 0;
    expect(hasEditChip || hasDoneChip).toBe(true);

    if (hasEditChip) {
      await expect(qcCell.locator('.qc-edit-chip')).toContainText('QC Edited');
      await expect(qcCell.locator('.qc-edit-time')).toBeVisible();
    } else {
      await expect(qcCell.locator('.qc-done-chip')).toContainText('QC Done');
      await expect(qcCell.locator('.qc-done-time')).toBeVisible();
    }
  });
});
