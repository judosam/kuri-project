import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'manager-dashboard.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5187', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --port 5187 --strictPort', url: 'http://127.0.0.1:5187', reuseExistingServer: false, timeout: 30000 },
});
