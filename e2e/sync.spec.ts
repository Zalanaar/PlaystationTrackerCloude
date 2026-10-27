import { test, expect } from '@playwright/test';
import { E2E_ENV } from './env';
import { signedSession } from './session';

// Защита API синка (БД и PSN в e2e недоступны: до них доходит только авторизованный запрос).
test.describe('API синка: доступ', () => {
  test('без сессии /api/sync и /api/sync/status = 401', async ({ request }) => {
    const s = await request.get('/api/sync/status', { maxRedirects: 0 });
    expect(s.status()).toBe(401);
    const p = await request.post('/api/sync', { data: {}, maxRedirects: 0 });
    expect(p.status()).toBe(401);
  });

  test('Bearer CRON_SECRET не открывает /api/sync и /api/sync/status', async ({ request }) => {
    const headers = { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` };
    expect((await request.get('/api/sync/status', { headers, maxRedirects: 0 })).status()).toBe(401);
    expect((await request.post('/api/sync', { headers, data: {}, maxRedirects: 0 })).status()).toBe(401);
  });

  test('сессия не открывает cron', async ({ request }) => {
    const r = await request.get('/api/cron/sync', { headers: { cookie: `pst_session=${await signedSession()}` }, maxRedirects: 0 });
    expect(r.status()).toBe(401);
  });

  test('cron: continue с мусором = 400 только после Bearer', async ({ request }) => {
    const h = { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` };
    expect((await request.get('/api/cron/sync?continue=abc', { headers: h, maxRedirects: 0 })).status()).toBe(400);
    expect((await request.get('/api/cron/sync?continue=abc', { maxRedirects: 0 })).status()).toBe(401);
  });

  test('сессия: status и POST доходят до БД (503 db_unavailable), без утечки деталей', async ({ request }) => {
    const cookie = `pst_session=${await signedSession()}`;
    const s = await request.get('/api/sync/status', { headers: { cookie }, maxRedirects: 0 });
    expect(s.status()).toBe(503);
    expect(await s.text()).not.toMatch(/postgres:|nopass|127\.0\.0\.1/);
    const p = await request.post('/api/sync', { headers: { cookie }, data: {}, maxRedirects: 0 });
    expect(p.status()).toBe(503);
    expect(await p.text()).not.toMatch(/postgres:|nopass|127\.0\.0\.1/);
  });

  test('POST /api/sync: чужой Origin и не-JSON = 400', async ({ request }) => {
    const cookie = `pst_session=${await signedSession()}`;
    const evil = await request.post('/api/sync', { headers: { cookie, origin: 'https://evil.example' }, data: {}, maxRedirects: 0 });
    expect(evil.status()).toBe(400);
    const form = await request.post('/api/sync', { headers: { cookie }, form: { a: 'b' }, maxRedirects: 0 });
    expect(form.status()).toBe(400);
  });
});
