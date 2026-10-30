import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateLimit } from './limiter';

// Имитация reserveLoginAttempt: строго последовательная резервация (как под advisory lock).
const store: { ip: string; at: Date; success: boolean }[] = [];
const calls: string[] = [];
vi.mock('./attempts', () => ({
  reserveLoginAttempt: vi.fn(async (ip: string) => {
    calls.push('reserve');
    await Promise.resolve();
    const now = new Date();
    const f = store.filter((r) => !r.success);
    const lim = evaluateLimit(f.filter((r) => r.ip === ip).map((r) => r.at), f.map((r) => r.at), now);
    if (lim.limited) return lim;
    store.push({ ip, at: now, success: false });
    return { limited: false, id: store.length - 1 };
  }),
  markLoginSuccess: vi.fn(async (id: number) => {
    calls.push('success');
    store[id].success = true;
  }),
}));

vi.mock('@/db', () => ({ getDb: () => ({}) }));
vi.mock('./users', () => ({ getOwner: vi.fn(async () => ({ id: 1, role: 'owner', status: 'active' })) }));

import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';

const PASS = 'correct-horse-battery';
function loginReq(password: string, ip = '1.1.1.1') {
  return new Request('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'localhost:3000', 'x-forwarded-for': ip },
    body: JSON.stringify({ password }),
  });
}

beforeEach(() => {
  store.length = 0;
  calls.length = 0;
  vi.stubEnv('ADMIN_PASSWORD', PASS);
  vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
});
afterEach(() => vi.unstubAllEnvs());

describe('B1: login резервирует попытку до сравнения пароля', () => {
  it('50 параллельных неверных паролей: ровно 5 дойдут до проверки, остальные 429', async () => {
    const res = await Promise.all(Array.from({ length: 50 }, () => login(loginReq('wrong'))));
    const codes = res.map((r) => r.status);
    expect(codes.filter((c) => c === 401)).toHaveLength(5);
    expect(codes.filter((c) => c === 429)).toHaveLength(45);
  });

  it('успешный вход не наказывается: запись становится success, лимит не съедается', async () => {
    for (let i = 0; i < 10; i++) expect((await login(loginReq(PASS))).status).toBe(200);
    expect(store.every((r) => r.success)).toBe(true);
    expect(calls.slice(0, 2)).toEqual(['reserve', 'success']);
  });

  it('429 не пишет новую попытку', async () => {
    for (let i = 0; i < 5; i++) await login(loginReq('wrong'));
    const before = store.length;
    expect((await login(loginReq('wrong'))).status).toBe(429);
    expect(store.length).toBe(before);
  });
}, 20000);

describe('B3: logout проверяет Origin и Content-Type', () => {
  const mk = (h: Record<string, string>) => new Request('http://localhost:3000/api/auth/logout', { method: 'POST', headers: { host: 'localhost:3000', ...h } });
  it('чужой Origin: 400', async () => {
    const r = await logout(mk({ 'content-type': 'application/json', origin: 'https://evil.example' }));
    expect(r.status).toBe(400);
    expect(r.headers.get('set-cookie')).toBeNull();
  });
  it('не JSON или без Content-Type: 400', async () => {
    expect((await logout(mk({ 'content-type': 'text/plain' }))).status).toBe(400);
    expect((await logout(mk({}))).status).toBe(400);
  });
  it('свой Origin и JSON: 200 и очистка cookie', async () => {
    const r = await logout(mk({ 'content-type': 'application/json', origin: 'http://localhost:3000' }));
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });
});
