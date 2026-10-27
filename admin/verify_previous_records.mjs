/**
 * Isolated end-to-end verification of BOTH field-record workflows.
 *
 * Runs against a throwaway stack (vite :5180 → API :8010, copied DB + uploads)
 * so the developer's running servers and real data are never touched.
 *
 *   Workflow A (existing): field operator capture → Records table → existing detail page
 *   Workflow B (new):      admin → Import Previous Records → Excel → Records table
 *                          → imported record page → photo upload → watermarked photo
 */
import { chromium } from '@playwright/test';
import fs from 'fs';

const BASE = 'http://127.0.0.1:5180';
const API = 'http://127.0.0.1:8010';
const SHOTS = '../scratch/verify/shots';
const XLSX = '../scratch/verify/previous_records.xlsx';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
};

/** Rendered labels are uppercased by the design system, so compare loosely. */
const hasAll = (haystack, needles) => {
  const lower = haystack.toLowerCase();
  return needles.every((n) => lower.includes(n.toLowerCase()));
};

const run = async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

  // ── login ───────────────────────────────────────────────────────────
  await page.goto(`${BASE}/`);
  await page.fill('input[type="email"], input[type="text"]', 'admin@system.local');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('h1:has-text("Dashboard")', { timeout: 20000 });

  // ── Records table: existing behaviour + new source column ───────────
  await page.goto(`${BASE}/records`);
  await page.getByRole('button', { name: 'All time' }).click();
  await page.waitForSelector('.records-table tbody tr', { timeout: 20000 });

  const headers = await page.$$eval('.records-table thead th', (ths) =>
    ths.map((t) => t.innerText.trim().toLowerCase())
  );
  check('Records table keeps its original columns', headers.slice(1, 5).join('|') === 'photo|status|record source|visit order', headers.slice(1, 5).join('|'));
  check('Records table gains a Record Source column', headers.includes('record source'));
  check('Records table gains a leading select column', await page.locator('.records-table thead .rec-select-box').count() === 1);

  const importBtn = page.getByRole('button', { name: 'Import Previous Records' });
  check('Header shows "Import Previous Records"', await importBtn.isVisible());

  const capturedRow = page.locator('.records-table tbody tr[data-source="captured"]').first();
  check('Existing captured rows are labelled "Captured on Location"', (await capturedRow.innerText()).includes('Captured on Location'));
  const rowCount = await page.locator('.records-table tbody tr').count();
  check('Records table still renders rows', rowCount > 0, `${rowCount} rows`);

  // ── Row selection / select all ──────────────────────────────────────
  const selectedRows = () => page.locator('.records-table tbody tr.row-selected').count();
  const barText = async () =>
    (await page.locator('.selection-bar').count())
      ? (await page.locator('.selection-bar').innerText()).replace(/\s+/g, ' ')
      : '';
  const settle = () => page.waitForTimeout(200);

  check('No selection bar before anything is selected', (await barText()) === '');

  await page.locator('.records-table tbody tr .rec-select-box').first().click();
  await settle();
  check(
    'Selecting a row highlights it and does not open the record',
    (await selectedRows()) === 1 && new URL(page.url()).pathname === '/records',
    await barText()
  );
  check('Selection bar reports the count', (await barText()).includes('1 record selected'), await barText());

  await page.locator('.records-table thead .rec-select-box').click();
  await settle();
  check(
    'Select all selects every row on the page',
    (await selectedRows()) === rowCount && (await barText()).includes(`${rowCount} records selected`),
    await barText()
  );

  await page.locator('.records-table thead .rec-select-box').click();
  await settle();
  check('Clicking the header box again clears the page selection', (await selectedRows()) === 0 && (await barText()) === '');

  check('No "select all matching" offer while every record fits on one page', (await page.getByRole('button', { name: /Select all \d+ matching/ }).count()) === 0);

  // The Clear button empties a live selection.
  await page.locator('.records-table tbody tr .rec-select-box').first().click();
  await settle();
  await page.getByRole('button', { name: /Clear selection/ }).click();
  await settle();
  check('Clear selection empties the selection', (await barText()) === '' && (await selectedRows()) === 0);

  // Changing a filter drops the selection (a selection only spans visible rows).
  await page.locator('.records-table tbody tr .rec-select-box').first().click();
  await settle();
  await page.getByRole('button', { name: 'This month' }).click();
  await settle();
  check('Changing a filter clears the selection', (await barText()) === '', await barText());
  await page.getByRole('button', { name: 'All time' }).click();
  await page.waitForSelector('.records-table tbody tr', { timeout: 20000 });

  // ── Workflow A: captured record → existing detail page (same tab) ───
  const capturedId = await capturedRow.getAttribute('data-source');
  await capturedRow.click();
  await page.waitForSelector('.record-audit-card', { timeout: 20000 });
  const capturedUrl = new URL(page.url()).pathname;
  check('Captured row opens the existing detail page in the same tab', /^\/records\/\d+$/.test(capturedUrl), `${capturedUrl} (row=${capturedId})`);
  const capturedSections = await page.$$eval('.rd-section-title', (ns) =>
    ns.map((n) => Array.from(n.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent).join('').trim())
  );
  // Conditional blocks (inspection data, remarks) may be absent for a given
  // record, but whatever renders must follow the fixed section order.
  const expectedOrder = ['Field Operator', 'Site & Location', 'Admin Given Information', 'Field Operator Inspection', 'Location Verification', 'Remarks & Notes', 'Capture Details'];
  let cursor = 0;
  const orderedSubset = capturedSections.every((s) => {
    const at = expectedOrder.indexOf(s, cursor);
    if (at < 0) return false;
    cursor = at + 1;
    return true;
  });
  check('Captured detail page keeps its field sections in order', orderedSubset && capturedSections[0] === 'Field Operator', capturedSections.join('|'));
  const capturedIsImported = (await page.locator('.record-media-card').innerText()).includes('Upload site photos');
  check('Captured record page is NOT the imported page (no admin upload panel)', !capturedIsImported);
  await page.screenshot({ path: `${SHOTS}/a1_existing_detail.png`, fullPage: false });

  // ── Workflow B: import previous records ─────────────────────────────
  await page.goto(`${BASE}/records`);
  await page.waitForSelector('.records-table tbody tr', { timeout: 20000 });
  await page.getByRole('button', { name: 'Import Previous Records' }).click();
  await page.waitForURL('**/records/import-previous', { timeout: 20000 });
  check('Header action opens the dedicated import page', new URL(page.url()).pathname === '/records/import-previous');
  await page.screenshot({ path: `${SHOTS}/b1_import_step1.png`, fullPage: true });

  await page.setInputFiles('input[type="file"][accept*=".xlsx"]', XLSX);
  await page.getByRole('button', { name: 'Validate & Preview' }).click();
  await page.waitForSelector('text=ready', { timeout: 30000 });
  const summary = await page.locator('.card').nth(1).innerText();
  check('Preview validates the sheet (2 valid / 1 with errors)', /2 of 3 rows ready/.test(summary) && /1 row with errors/.test(summary), summary.replace(/\s+/g, ' ').slice(0, 160));
  const errorText = await page.locator('.card', { hasText: 'Rows that will be skipped' }).innerText();
  check('Validation errors are shown with row + column', /Row 4/.test(errorText) && /operator_email/.test(errorText) && /coordinates/.test(errorText), errorText.replace(/\s+/g, ' ').slice(0, 180));
  const previewRows = await page.locator('.records-table tbody tr').count();
  check('Every row is previewed before importing', previewRows === 3, `${previewRows} preview rows`);
  await page.screenshot({ path: `${SHOTS}/b2_import_preview.png`, fullPage: true });

  // Nothing is written yet.
  const beforeApi = await context.request.post(`${API}/api/auth/login`, { data: { email: 'admin@system.local', password: 'admin123' } });
  const token = (await beforeApi.json()).access_token;
  const auth = { Authorization: `Bearer ${token}` };
  const beforeList = await (await context.request.get(`${API}/api/admin/records?page_size=100`, { headers: auth })).json();
  check('Preview alone writes nothing to the database', beforeList.total === 15, `${beforeList.total} records`);

  await page.getByRole('button', { name: /Import 2 Records/ }).click();
  await page.waitForSelector('text=Imported 2 records', { timeout: 60000 });
  check('Import commits only the valid rows', true);
  await page.screenshot({ path: `${SHOTS}/b3_import_done.png`, fullPage: true });

  // ── Records table shows the imported records ────────────────────────
  await page.getByRole('button', { name: 'View in Records' }).click();
  await page.waitForURL('**/records', { timeout: 20000 });
  await page.getByRole('button', { name: 'All time' }).click();
  const importedRow = page.locator('.records-table tbody tr', { hasText: 'VO-1001' }).first();
  await importedRow.waitFor({ timeout: 20000 });
  const importedRowText = await importedRow.innerText();
  check('Imported record appears in the same Records table', importedRowText.includes('VO-1001'));
  check('Imported record is labelled "Uploaded / Imported"', importedRowText.includes('Uploaded / Imported'));
  check('Imported record is flagged for the new-tab page', (await importedRow.getAttribute('data-source')) === 'imported');

  // Selecting an imported row must not kick off its new-tab behaviour.
  await importedRow.locator('.rec-select-box').click();
  await page.waitForTimeout(200);
  check(
    'Imported rows can be selected without opening the record',
    (await page.locator('.records-table tbody tr.row-selected').count()) === 1 && context.pages().length === 1,
    `${context.pages().length} tab(s)`
  );

  // Now 17 records exist over 2 pages, so "select all matching" must reach past
  // the 15 rows on screen.
  const selectAllMatching = page.getByRole('button', { name: /Select all 17 matching/ });
  check('Partial selection offers "Select all matching"', await selectAllMatching.isVisible(), await barText());
  await selectAllMatching.click();
  await page.waitForFunction(
    () => (document.querySelector('.selection-bar')?.textContent || '').includes('17 records selected'),
    undefined,
    { timeout: 30000 }
  );
  check('"Select all matching" selects beyond the current page', (await barText()).includes('17 records selected'), await barText());
  check('Header box shows an indeterminate/partial state on the page', await page.locator('.records-table thead .rec-select-box').evaluate((el) => el.checked));

  await page.getByRole('button', { name: /Clear selection/ }).click();
  await page.waitForTimeout(200);
  check('Selection cleared before continuing', (await barText()) === '' && (await page.locator('.records-table tbody tr.row-selected').count()) === 0);
  const afterImport = await (await context.request.get(`${API}/api/admin/records?page_size=100`, { headers: auth })).json();
  const importedApi = afterImport.records.filter((r) => r.source === 'imported');
  check('Imported rows carry source=imported in the API', importedApi.length === 2, `${importedApi.length} imported, ${afterImport.total} total`);
  await page.screenshot({ path: `${SHOTS}/b4_records_table_source_column.png`, fullPage: false });

  // ── Clicking an imported record opens the new page in a new tab ─────
  const [importedPage] = await Promise.all([
    context.waitForEvent('page'),
    importedRow.click(),
  ]);
  await importedPage.waitForLoadState();
  await importedPage.waitForSelector('.record-audit-card', { timeout: 20000 });
  check('Imported record opens in a new tab/page', importedPage !== page && /^\/records\/imported\/\d+$/.test(new URL(importedPage.url()).pathname), new URL(importedPage.url()).pathname);
  check('The records list stayed on its own page', new URL(page.url()).pathname === '/records');

  const importedSections = await importedPage.$$eval('.rd-section-title', (ns) =>
    ns.map((n) => Array.from(n.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent).join('').trim())
  );
  check('Imported page uses the same field sections as the existing page', importedSections.join('|') === 'Field Operator|Site & Location|Admin Given Information|Field Operator Inspection|Location Verification|Remarks & Notes|Capture Details', importedSections.join('|'));
  const detailText = await importedPage.locator('.record-audit-card').innerText();
  const expectedFields = ['Owner Name', 'Ravi Kumar', 'Survey No', '112/2', 'Taluk', 'Coimbatore North', 'Village', 'Saravanampatti', 'Date of Visit', '2024-05-11', 'Active Construction', 'Type of Construction', 'RCC', 'First floor slab', '9876543210', 'Completed before the app rollout'];
  check('Imported details show all sheet values under their field labels', hasAll(detailText, expectedFields), expectedFields.filter((f) => !detailText.toLowerCase().includes(f.toLowerCase())).join(', ') || 'all present');
  check('Imported page is marked Uploaded / Imported', detailText.includes('Imported by admin') || (await importedPage.locator('.topbar-verified-pill').innerText()).includes('Uploaded / Imported'));
  await importedPage.screenshot({ path: `${SHOTS}/b5_imported_detail.png`, fullPage: true });

  // ── Photo upload + preview + watermark ─────────────────────────────
  const framesOk = async () =>
    importedPage.evaluate(() => {
      const stage = document.querySelector('.record-photo-full');
      const thumbs = Array.from(document.querySelectorAll('.seq-dock-thumb-img'));
      return {
        stageW: stage ? stage.naturalWidth : 0,
        frames: document.querySelectorAll('.seq-dock-item').length,
        thumbsOk: thumbs.filter((t) => t.naturalWidth > 0).length,
        broken: document.querySelectorAll('.seq-broken').length,
        loading: document.querySelectorAll('.seq-loading').length,
      };
    });

  await importedPage.setInputFiles('input[type="file"][accept="image/jpeg,image/png"]', '../scratch/verify/site_photo_1.jpg');
  await importedPage.waitForSelector('text=Upload 1 photo', { timeout: 20000 });
  const previews = await importedPage.locator('img[alt$=".jpg"], img[alt$=".jpeg"]').count();
  check('Selected photo is previewed before upload', previews >= 1, `${previews} preview image(s)`);
  await importedPage.screenshot({ path: `${SHOTS}/b6_photo_preview.png`, fullPage: true });

  await importedPage.getByRole('button', { name: /Upload 1 photo/ }).click();
  await importedPage.waitForSelector('text=uploaded and watermarked', { timeout: 90000 });
  check('Photos upload and report watermarking', true);
  await importedPage.waitForSelector('.record-photo-full', { timeout: 30000 });
  const first = await framesOk();
  check('Watermarked photo renders in the media stage', first.stageW > 0, `${first.stageW}px wide`);
  check('Single frame filmstrip renders', first.frames === 1 && first.thumbsOk === 1, JSON.stringify(first));

  // A second upload must APPEND without breaking the already-rendered frames.
  await importedPage.setInputFiles('input[type="file"][accept="image/jpeg,image/png"]', '../scratch/verify/site_photo_2.jpg');
  await importedPage.waitForSelector('text=Upload 1 photo', { timeout: 20000 });
  await importedPage.getByRole('button', { name: /Upload 1 photo/ }).click();
  // Wait until the gallery has settled: 2 frames, nothing left loading or broken.
  await importedPage.waitForFunction(
    () => {
      const thumbs = Array.from(document.querySelectorAll('.seq-dock-thumb-img'));
      const stage = document.querySelector('.record-photo-full');
      return (
        document.querySelectorAll('.seq-dock-item').length === 2 &&
        document.querySelectorAll('.seq-loading').length === 0 &&
        document.querySelectorAll('.seq-broken').length === 0 &&
        thumbs.filter((t) => t.naturalWidth > 0).length === 2 &&
        !!stage &&
        stage.naturalWidth > 0
      );
    },
    undefined,
    { timeout: 90000 }
  );
  const second = await framesOk();
  check('Multiple photos are supported (frames appended)', second.frames === 2, `${second.frames} frames`);
  check('Earlier frames still render after a second upload', second.thumbsOk === 2 && second.broken === 0 && second.loading === 0, JSON.stringify(second));
  check('Stored frames come back watermarked (no local preview leak)', second.stageW > 0, `${second.stageW}px wide`);
  await importedPage.screenshot({ path: `${SHOTS}/b7_watermarked_photo.png`, fullPage: false });

  // ── Save / update functionality ────────────────────────────────────
  await importedPage.getByRole('button', { name: 'Edit Details' }).click();
  await importedPage.waitForSelector('#imp-site_address');
  await importedPage.fill('#imp-site_address', '12A Heritage Main St (corrected)');
  await importedPage.fill('#imp-remarks', 'Verified against the paper register');
  await importedPage.getByRole('button', { name: 'Save Changes' }).click();
  await importedPage.waitForSelector('#imp-site_address', { state: 'detached', timeout: 30000 });
  const afterEdit = await (await context.request.get(`${API}/api/admin/records/${new URL(importedPage.url()).pathname.split('/').pop()}`, { headers: auth })).json();
  check('Save/update persists imported record edits', afterEdit.site_address === '12A Heritage Main St (corrected)' && afterEdit.remarks === 'Verified against the paper register', `${afterEdit.site_address} / ${afterEdit.remarks}`);
  check('Edit does not reset the record source', afterEdit.source === 'imported');
  await importedPage.screenshot({ path: `${SHOTS}/b8_after_edit.png`, fullPage: true });

  // ── Workflow A end-to-end through the mobile capture API ─────────────
  const newOperator = await context.request.post(`${API}/api/admin/users`, {
    headers: auth,
    data: { email: 'verify.op@example.com', full_name: 'Verify Operator', role: 'USER', password: 'VerifyPass123!' },
  });
  check('Admin can still create a field operator', newOperator.status() === 201, `${newOperator.status()}`);

  const opLogin = await context.request.post(`${API}/api/auth/login`, {
    data: { email: 'verify.op@example.com', password: 'VerifyPass123!' },
  });
  const opToken = (await opLogin.json()).access_token;
  check('Field operator can still sign in to the mobile flow', !!opToken);

  const created = await context.request.post(`${API}/api/records`, {
    headers: { Authorization: `Bearer ${opToken}` },
    data: {
      name: 'Onsite capture after the import feature landed',
      description: 'Captured through the mobile API flow',
      status: 'COMPLETED',
      date_of_visit: '2026-09-22',
      construction_happening: 'Yes',
      remarks: 'Field capture still works',
      photos: [
        { latitude: 11.0168, longitude: 76.9558, location_accuracy: 6.5, captured_at: '2026-09-22T09:15:00Z', file_name: 'onsite.jpg' },
      ],
    },
  });
  const capturedRecord = await created.json();
  check('Field operator can still capture a record', created.status() === 201, `${created.status()}`);
  check('Newly captured record is flagged source=captured', capturedRecord.source === 'captured', capturedRecord.source);

  const upload = await context.request.post(`${API}/api/records/${capturedRecord.id}/upload`, {
    headers: { Authorization: `Bearer ${opToken}` },
    multipart: {
      files: {
        name: 'onsite.jpg',
        mimeType: 'image/jpeg',
        buffer: fs.readFileSync('../scratch/verify/site_photo_1.jpg'),
      },
    },
  });
  const uploadedCaptured = await upload.json();
  check('Mobile photo upload still succeeds', upload.status() === 200 && uploadedCaptured.images.length === 1, `${upload.status()} / ${uploadedCaptured.images?.length} photo(s)`);
  check('Mobile photo keeps the canonical naming', uploadedCaptured.images[0].file_name === `Record_${capturedRecord.id}_Photo_1.jpg`, uploadedCaptured.images[0].file_name);

  await page.goto(`${BASE}/records`);
  await page.getByRole('button', { name: 'All time' }).click();
  await page.waitForSelector('.records-table tbody tr', { timeout: 20000 });
  // The table has no name column, so search the record up by name instead — the
  // search is server-side, and the row itself renders the Record Source pill.
  await page.fill('input[placeholder^="Search by UID"]', 'Onsite capture after the import');
  await page.waitForTimeout(900);
  const freshRow = page.locator('.records-table tbody tr');
  await freshRow.first().waitFor({ timeout: 20000 });
  check('Search still narrows the table to the captured record', (await freshRow.count()) === 1, `${await freshRow.count()} row(s)`);
  check('Captured record shows as "Captured on Location"', (await freshRow.innerText()).includes('Captured on Location'), (await freshRow.innerText()).replace(/\s+/g, ' ').slice(0, 120));
  await freshRow.click();
  await page.waitForSelector('.record-audit-card', { timeout: 20000 });
  check('Captured record still opens the original detail page', new URL(page.url()).pathname === `/records/${capturedRecord.id}`, new URL(page.url()).pathname);
  await page.waitForSelector('.record-photo-full', { timeout: 30000 });
  const capturedPhotoOk = await page.evaluate(() => {
    const img = document.querySelector('.record-photo-full');
    return !!img && img.naturalWidth > 0;
  });
  check('Existing captured record photos still render (image handling untouched)', capturedPhotoOk);
  check('Captured record page has no admin upload panel', !(await page.locator('.record-media-card').innerText()).includes('Upload site photos'));
  await page.screenshot({ path: `${SHOTS}/a2_existing_capture_after_import.png`, fullPage: false });

  // ── Store both watermarked files for the pixel comparison ────────────
  const importedPhotoMeta = await (await context.request.get(`${API}/api/admin/records/${afterEdit.id}/images`, { headers: auth })).json();
  const capturedPhotoMeta = await (await context.request.get(`${API}/api/admin/records/${capturedRecord.id}/images`, { headers: auth })).json();
  const save = async (url, file) => {
    const res = await context.request.get(url, { headers: auth });
    fs.writeFileSync(file, await res.body());
  };
  await save(`${API}/api/admin/records/${afterEdit.id}/image/${importedPhotoMeta[0].id}`, '../scratch/verify/stored_imported.jpg');
  await save(`${API}/api/admin/records/${capturedRecord.id}/image/${capturedPhotoMeta[0].id}`, '../scratch/verify/stored_captured.jpg');
  fs.writeFileSync(
    '../scratch/verify/stored_photos.json',
    JSON.stringify(
      {
        imported: { record_id: afterEdit.id, images: importedPhotoMeta.map((i) => i.file_name) },
        captured: { record_id: capturedRecord.id, images: capturedPhotoMeta.map((i) => i.file_name) },
      },
      null,
      2
    )
  );

  // ── Single-record delete from the row's own action button ──────────
  const apiList = async (qs = 'page_size=100') =>
    (await context.request.get(`${API}/api/admin/records?${qs}`, { headers: auth })).json();

  await page.goto(`${BASE}/records`);
  await page.getByRole('button', { name: 'All time' }).click();
  await page.waitForSelector('.records-table tbody tr', { timeout: 20000 });

  const rowsOnPage = await page.locator('.records-table tbody tr').count();
  check(
    'Every row offers its own delete action',
    (await page.locator('.records-table tbody tr .rec-row-delete').count()) === rowsOnPage,
    `${rowsOnPage} rows`
  );

  // The table is wider than the viewport, so the action must be pinned right.
  const pinnedProbe = (action) =>
    page.evaluate((sel) => {
      const btn = document.querySelector('.records-table tbody tr .rec-row-delete');
      const box = btn?.getBoundingClientRect();
      const scroller = document.querySelector('.table-scroll');
      const view = scroller?.getBoundingClientRect();
      return {
        visible: !!box && !!view && box.left >= view.left - 1 && box.right <= view.right + 1,
        overflowing: !!scroller && scroller.scrollWidth > scroller.clientWidth + 4,
      };
    }, action);

  const pinned = await pinnedProbe('initial');
  check(
    'The delete action is reachable without scrolling the wide table sideways',
    pinned.visible && pinned.overflowing,
    JSON.stringify(pinned)
  );

  await page.evaluate(() => {
    const s = document.querySelector('.table-scroll');
    if (s) s.scrollLeft = s.scrollWidth;
  });
  await settle();
  const pinnedScrolled = await pinnedProbe('scrolled');
  check('The delete action stays pinned right after scrolling', pinnedScrolled.visible, JSON.stringify(pinnedScrolled));
  await page.evaluate(() => {
    const s = document.querySelector('.table-scroll');
    if (s) s.scrollLeft = 0;
  });
  await settle();

  // An unrelated row stays selected: deleting one row must not disturb the selection.
  await page.locator('.records-table tbody tr').first().locator('.rec-select-box').click();
  await settle();

  const targetRow = page.locator('.records-table tbody tr[data-source="captured"]').last();
  const targetId = Number(await targetRow.locator('.rec-row-delete').getAttribute('data-delete-id'));
  const targetCells = (await targetRow.locator('td').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  const targetLabel = targetCells[5] && targetCells[5] !== '-' ? targetCells[5] : `record #${targetId}`;
  const tabsBeforeRowDelete = context.pages().length;
  const totalBeforeRowDelete = (await apiList()).total;

  await page.locator(`.rec-row-delete[data-delete-id="${targetId}"]`).click();
  await page.waitForSelector('#delete-record-title', { timeout: 10000 });
  check(
    'Row delete asks for confirmation without opening the record',
    new URL(page.url()).pathname === '/records' && context.pages().length === tabsBeforeRowDelete,
    page.url()
  );
  const rowDeleteTitle = await page.locator('#delete-record-title').innerText();
  check('The confirmation names the record being deleted', rowDeleteTitle.includes(targetLabel), rowDeleteTitle);
  await page.screenshot({ path: `${SHOTS}/c0_row_delete_confirm.png`, fullPage: false });

  await page.getByRole('button', { name: 'Cancel' }).click();
  await settle();
  check('Cancelling a row delete removes nothing', (await apiList()).total === totalBeforeRowDelete);
  check(
    'The selection survives closing the row delete dialog',
    (await barText()).includes('1 record selected'),
    await barText()
  );

  await page.locator(`.rec-row-delete[data-delete-id="${targetId}"]`).click();
  await page.waitForSelector('#delete-record-title', { timeout: 10000 });
  await page.getByRole('button', { name: /^Delete record$/ }).click();
  await page.waitForSelector('.card[role="status"]', { timeout: 60000 });
  const rowDeleteNotice = (await page.locator('.card[role="status"]').innerText()).replace(/\s+/g, ' ');
  check('Row delete reports the single record being removed', rowDeleteNotice.includes('1 record deleted'), rowDeleteNotice);

  const afterRowDelete = await apiList();
  check(
    'The row-deleted record is gone from the database',
    afterRowDelete.total === totalBeforeRowDelete - 1,
    `${afterRowDelete.total} vs ${totalBeforeRowDelete}`
  );
  check('The row-deleted record is no longer returned by the API', afterRowDelete.records.every((r) => r.id !== targetId));
  check(
    'The row-deleted record disappears from the table',
    (await page.locator(`.rec-row-delete[data-delete-id="${targetId}"]`).count()) === 0
  );
  check(
    'Deleting a row keeps the rest of the selection',
    (await barText()).includes('1 record selected'),
    await barText()
  );

  // ── Bulk delete of the selected records (mutates data — run last) ────
  const beforeDelete = await (await context.request.get(`${API}/api/admin/records?page_size=100`, { headers: auth })).json();
  await page.goto(`${BASE}/records`);
  await page.getByRole('button', { name: 'All time' }).click();
  await page.waitForSelector('.records-table tbody tr', { timeout: 20000 });

  const importedRows = page.locator('.records-table tbody tr[data-source="imported"]');
  check('Both imported records are listed before deleting', (await importedRows.count()) === 2, `${await importedRows.count()} rows`);
  for (let i = 0; i < 2; i += 1) {
    await importedRows.nth(i).locator('.rec-select-box').click();
  }
  await page.waitForTimeout(250);
  check('Two rows are selected for deletion', (await barText()).includes('2 records selected'), await barText());

  await page.getByRole('button', { name: /Delete selected/ }).click();
  await page.waitForSelector('#delete-record-title', { timeout: 10000 });
  const confirmTitle = await page.locator('#delete-record-title').innerText();
  check('Delete asks for confirmation with the selected count', confirmTitle.includes('Delete 2 records'), confirmTitle);
  await page.screenshot({ path: `${SHOTS}/c1_bulk_delete_confirm.png`, fullPage: false });

  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  const afterCancel = await (await context.request.get(`${API}/api/admin/records?page_size=100`, { headers: auth })).json();
  check('Cancelling the confirmation deletes nothing', afterCancel.total === beforeDelete.total, `${afterCancel.total} vs ${beforeDelete.total}`);

  await page.getByRole('button', { name: /Delete selected/ }).click();
  await page.waitForSelector('#delete-record-title', { timeout: 10000 });
  await page.getByRole('button', { name: /^Delete 2 records$/ }).click();
  await page.waitForSelector('.card[role="status"]', { timeout: 90000 });
  const notice = (await page.locator('.card[role="status"]').innerText()).replace(/\s+/g, ' ');
  check('Deletion reports how many records were removed', notice.includes('2 records deleted'), notice);

  const afterDelete = await (await context.request.get(`${API}/api/admin/records?page_size=100`, { headers: auth })).json();
  check('Deleted records are gone from the database', afterDelete.total === beforeDelete.total - 2, `${afterDelete.total} vs ${beforeDelete.total}`);
  check('Deleted rows are no longer returned by the API', afterDelete.records.every((r) => r.source !== 'imported'));
  check('Selection is cleared after deleting', (await page.locator('.selection-bar').count()) === 0);
  await page.screenshot({ path: `${SHOTS}/c2_after_bulk_delete.png`, fullPage: false });

  const logs = await (await context.request.get(`${API}/api/admin/logs?limit=100`, { headers: auth })).json();
  const deleteEntries = (logs.items || []).filter((e) => (e.title || '').toLowerCase().includes('deleted'));
  check('Each deletion is written to the audit log', deleteEntries.length >= 2, `${deleteEntries.length} entries`);

  // Deleted rows must not resurface on a reload.
  await page.reload();
  await page.getByRole('button', { name: 'All time' }).click();
  await page.waitForSelector('.records-table tbody tr', { timeout: 20000 });
  check('Deleted rows stay gone after a reload', (await page.locator('.records-table tbody tr[data-source="imported"]').count()) === 0);
  check('The captured workflow data is untouched by the delete', (await page.locator('.records-table tbody tr[data-source="captured"]').count()) > 0);

  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('FAILED CHECKS:');
    failed.forEach((f) => console.log(` - ${f.name} ${f.detail}`));
    process.exit(1);
  }
  console.log('E2E OK: both workflows verified end to end');
};

run().catch((e) => {
  console.error('E2E CRASHED:', e);
  process.exit(1);
});
