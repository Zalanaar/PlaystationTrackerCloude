// Тестовые секреты для e2e. Передаются dev-серверу из playwright.config.ts и перекрывают .env.
// DATABASE_URL заведомо недоступен: e2e не трогает реальную БД.
export const E2E_ENV = {
  ADMIN_PASSWORD: 'e2e-admin-password-123',
  SESSION_SECRET: 'e2e-session-secret-'.padEnd(48, 'x'),
  CRON_SECRET: 'e2e-cron-secret-'.padEnd(48, 'y'),
  // фиктивные настройки PSN: детерминированный путь до БД (503), реальный PSN не вызывается
  PSN_TARGET_ONLINE_ID: 'e2e-target',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PSN_NPSSO: '',
  DATABASE_URL: 'postgres://nobody:nopass@127.0.0.1:1/none',
};
