import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'capture-dashboard.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5187', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'npm run dev -- --port 5187 --strictPort', url: 'http://127.0.0.1:5187', reuseExistingServer: false, timeout: 30000 },
    { command: 'npm --prefix ../user-web run dev -- --port 5188 --strictPort', url: 'http://127.0.0.1:5188/app/', reuseExistingServer: false, timeout: 30000 },
  ],
});
