import { defineConfig } from '@playwright/test';

// The e2e suite drives a real browser against a running stack (API + client).
// Start the API with a MongoDB (see docs/DEPLOY.md), then: E2E_BASE_URL=http://localhost:5173 npm run e2e
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] },
  },
});
