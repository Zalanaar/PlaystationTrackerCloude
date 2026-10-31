// Конфиг для QA на свободном порту (основной playwright.config.ts занят 3100): QA_PORT=3217 npx playwright test -c e2e/qa.config.ts <файл>
import { defineConfig, devices } from '@playwright/test';
import { E2E_ENV } from './env';

const PORT = Number(process.env.QA_PORT ?? 3217);
const launchOptions = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  workers: 3,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
  ],
  webServer: { command: `npm run dev -- --port ${PORT}`, cwd: '..', url: `http://localhost:${PORT}`, reuseExistingServer: false, env: E2E_ENV, timeout: 120_000 },
});
