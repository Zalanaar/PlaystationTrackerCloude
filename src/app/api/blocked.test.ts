// Охранный тест B-2 (контракт 22.12): каждый API-роут без сессии отвечает 401. Публичны только вход и cron (там свой секрет).
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API = __dirname;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Роуты без requireUser и причина. */
const PUBLIC: Record<string, string> = {
  'auth/login/route.ts': 'вход паролем',
  'auth/logout/route.ts': 'выход',
  'auth/google/route.ts': 'старт входа Google',
  'auth/google/callback/route.ts': 'callback входа Google',
  'cron/sync/route.ts': 'CRON_SECRET',
  'cron/watchdog/route.ts': 'CRON_SECRET',
  'cron/digest/route.ts': 'CRON_SECRET',
  'telegram/webhook/route.ts': 'секрет webhook Telegram (X-Telegram-Bot-Api-Secret-Token)',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name === 'route.ts') out.push(p);
  }
  return out;
}

// БД не нужна: проверка сессии идёт до обращения к ней, а без cookie БД не вызывается вообще
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    throw new Error('БД не должна вызываться без сессии');
  },
}));

describe('blocked: все API-роуты без сессии = 401', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
    vi.stubEnv('CRON_SECRET', 'c'.repeat(40));
  });
  afterEach(() => vi.unstubAllEnvs());

  const routes = walk(API).map((f) => ({ file: f, rel: relative(API, f).split(sep).join('/') }));

  it('список роутов не пуст и публичный allowlist актуален', () => {
    expect(routes.length).toBeGreaterThan(40);
    for (const rel of Object.keys(PUBLIC)) expect(routes.some((r) => r.rel === rel), rel).toBe(true);
  });

  for (const { file, rel } of walk(API).map((f) => ({ file: f, rel: relative(API, f).split(sep).join('/') }))) {
    if (PUBLIC[rel]) continue;
    it(`${rel}: без cookie 401`, async () => {
      const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
      const handlers = METHODS.filter((m) => typeof mod[m] === 'function');
      expect(handlers.length, 'у роута нет HTTP-обработчиков').toBeGreaterThan(0);
      for (const m of handlers) {
        const req = new Request('http://localhost/api/x', {
          method: m,
          headers: { 'content-type': 'application/json', host: 'localhost' },
          ...(m === 'GET' ? {} : { body: '{}' }),
        });
        // параметры пути: любые строки, чужие значения здесь не важны
        const ctx = { params: Promise.resolve({ id: '1', gameId: '1', externalId: 'x' }) };
        const res = await (mod[m] as (r: Request, c: unknown) => Promise<Response>)(req, ctx);
        expect(res.status, `${m} ${rel}`).toBe(401);
        expect((await res.json()).error.code).toBe('unauthorized');
      }
    });
  }

  it('cron-роуты без Bearer тоже 401', async () => {
    for (const rel of ['cron/sync/route.ts', 'cron/watchdog/route.ts', 'cron/digest/route.ts']) {
      const mod = (await import(/* @vite-ignore */ join(API, rel))) as { GET: (r: Request) => Promise<Response> };
      expect((await mod.GET(new Request('http://localhost/api/cron'))).status, rel).toBe(401);
    }
  });
});
