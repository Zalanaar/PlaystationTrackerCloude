// Фаза 39 (QA): SW работает только в production, поэтому сборка и `next start`.
// PWA_PORT=3231 npx playwright test -c e2e/pwa.config.ts [phase39-pwa.spec.ts]
// Если сборка уже есть (.next), PWA_SKIP_BUILD=1 пропускает `next build`.
import { defineConfig, devices } from '@playwright/test';
import { E2E_ENV } from './env';

const PORT = Number(process.env.PWA_PORT ?? 3231);
const launchOptions = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};
const start = `npx next start -p ${PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: /phase39-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
  ],
  webServer: {
    command: process.env.PWA_SKIP_BUILD ? start : `npx next build && ${start}`,
    cwd: '..',
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    env: E2E_ENV,
    timeout: 600_000,
  },
});
