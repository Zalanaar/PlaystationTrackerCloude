import { defineConfig, devices } from '@playwright/test';
import { E2E_ENV } from './e2e/env';

const PORT = 3100;
// Локальные песочницы без скачанного браузера: PW_CHROMIUM_PATH=/путь/к/chromium. В CI не задаётся.
const executablePath = process.env.PW_CHROMIUM_PATH;
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: './e2e',
  // Фаза 39: PWA-спеки требуют прод-сборки с Service Worker и идут только через e2e/pwa.config.ts (npm run e2e:pwa).
  testIgnore: /pwa-build.*\.spec\.ts/,
  fullyParallel: true,
  // В CI ещё и github: ошибки тестов видны аннотациями в проверке, даже если лог job недоступен.
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    // Пакет 6, п. 3: время суток показывается по поясу устройства; фиксируем пояс, чтобы тесты не зависели от машины (CI = UTC).
    timezoneId: 'Europe/Moscow',
    // Фаза 33: Бэклог на мобильном по умолчанию «Список», а старые тесты рассчитаны на сетку карточек.
    // Новые тесты вида (backlog-view.spec.ts и др.) сбрасывают это через test.use({ storageState: { cookies: [], origins: [] } }).
    storageState: { cookies: [], origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: 'ps-bl-view', value: 'cards' }] }] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
    // WebKit как Safari на iPhone: регресс прокрутки окна игры и первый экран Коллекции (D-P1); в CI — отдельная job.
    // Раньше здесь был workers: 1 из-за «зависаний WPE». Настоящая причина — backdrop-filter на бейдже каждой карточки
    // (см. .ps-card__glyph в collection.css): поток композитора WPE уходил в 100% CPU и съедал память до OOM.
    { name: 'webkit-iphone', testMatch: /(dialog-scroll|first-screen-iphone|trophy-feed|stats-sections|guides|wrapped-best|wrapped-preview|mobile-polish|other-platforms|sticky-rows|tap-targets|collection-zero-chips|page-head|trophy-near)\.spec\.ts/, use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false, // чужой dev-сервер имеет другие секреты
    env: E2E_ENV,
    timeout: 120_000,
  },
});
