import { defineConfig, devices } from '@playwright/test';
import { E2E_ENV } from './e2e/env';

const PORT = 3100;
// Локальные песочницы без скачанного браузера: PW_CHROMIUM_PATH=/путь/к/chromium. В CI не задаётся.
const executablePath = process.env.PW_CHROMIUM_PATH;
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: './e2e',
  // Фаза 39: PWA-спеки требуют прод-сборки с Service Worker и идут только через e2e/pwa.config.ts (npm run e2e:pwa).
  testIgnore: /phase39-.*\.spec\.ts/,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    // Фаза 33: Бэклог на мобильном по умолчанию «Список», а старые тесты рассчитаны на сетку карточек.
    // Новые тесты вида (phase33-*.spec.ts) сбрасывают это через test.use({ storageState: { cookies: [], origins: [] } }).
    storageState: { cookies: [], origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: 'ps-bl-view', value: 'cards' }] }] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
    // WebKit как Safari на iPhone: только регресс прокрутки окна игры (в CI не запускается, там только desktop).
    // Повторы: headless WPE иногда зависает на page.evaluate, это не ошибка приложения
    { name: 'webkit-iphone', testMatch: /dialog-scroll\.spec\.ts/, retries: 2, use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false, // чужой dev-сервер имеет другие секреты
    env: E2E_ENV,
    timeout: 120_000,
  },
});
