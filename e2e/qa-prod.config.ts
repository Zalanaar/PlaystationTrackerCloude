// QA: прогон против уже запущенной прод-сборки (next build + next start на свободном порту).
// /tmp/.../envrun.sh npx next start -p 3218; QA_PORT=3218 CSP_PROD=1 npx playwright test -c e2e/qa-prod.config.ts <файл>
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.QA_PORT ?? 3218);
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
});
