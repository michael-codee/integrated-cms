import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against a running deployment (e.g. `vite preview` in
 * front of the API). Provide an existing account through the environment:
 *   E2E_BASE_URL=http://127.0.0.1:4173 E2E_USER=… E2E_PASSWORD=… npm run e2e
 * The account needs attendance.create in at least one unit.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  use: {
    // PLAYWRIGHT_CHROMIUM lets CI or a workstation point at an already-installed browser.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4173', serviceWorkers: 'allow', trace: 'off' },
});
