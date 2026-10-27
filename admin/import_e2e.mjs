import { chromium } from '@playwright/test';
import fs from 'fs';

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Login
  await page.goto('http://localhost:5173/');
  await page.fill('input[type="email"], input[type="text"]', 'admin@system.local');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button:has-text("Sign In")');
  await page.waitForSelector('text=Dashboard', { timeout: 15000 });

  // Open the new import page
  await page.goto('http://localhost:5173/records/import');
  await page.waitForSelector('text=Import Completed Field Work');
  await page.screenshot({ path: '../scratch/e2e_1_landing.png' });

  // Upload the sheet
  await page.setInputFiles('input[type="file"][accept*=".xlsx"]', '../scratch/rework_sheet.xlsx');
  await page.waitForSelector('text=rework_sheet.xlsx');
  await page.screenshot({ path: '../scratch/e2e_2_file_picked.png' });

  // Import
  await page.click('button:has-text("Import Completed Records")');
  await page.waitForSelector('text=Imported 2 records', { timeout: 20000 });
  await page.waitForSelector('text=RWK-001');
  await page.waitForSelector('text=RWK-002');
  await page.screenshot({ path: '../scratch/e2e_3_review.png', fullPage: true });

  // Attach photo to the first record card only
  const firstCard = page.locator('.card', { hasText: 'RWK-001' });
  await firstCard.locator('input[type="file"][accept="image/*"]').setInputFiles('../scratch/rework_photo.jpg');
  await firstCard.locator('button:has-text("Upload Photos")').click();
  await firstCard.locator('text=Photos uploaded & watermarked').waitFor({ timeout: 30000 });
  await page.screenshot({ path: '../scratch/e2e_4_uploaded.png', fullPage: true });

  console.log('E2E OK: import + photo upload + watermark flow complete');
  await browser.close();
};

run().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
