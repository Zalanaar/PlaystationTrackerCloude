import { defineConfig, devices } from '@playwright/test';
import { E2E_ENV } from './e2e/env';

const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'on-first-retry' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false, // чужой dev-сервер имеет другие секреты
    env: E2E_ENV,
    timeout: 120_000,
  },
});
