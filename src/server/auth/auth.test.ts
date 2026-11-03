import { describe, expect, it } from 'vitest';
import { b64urlEncode, createSessionTokenV2, SESSION_TTL_SECONDS, verifySessionToken } from './session';
import { checkBearer, checkPassword, hashIp, secureEqual } from './password';
import { evaluateLimit, GLOBAL_LIMIT, NPSSO_RULES } from './limiter';
import { getAuthEnv, getCronSecret, getSessionSecret } from '../env';
import { safeNext } from '../http';

const SECRET = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const createSessionToken = (secret: string | null | undefined, nowMs?: number) => createSessionTokenV2(secret, { uid: 1, role: 'owner', amr: 'pwd' }, nowMs);

describe('session cookie', () => {
  it('подписанный токен проходит проверку', async () => {
    const t = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(t, SECRET, NOW + 1000)).toBe(true);
  });
  it('чужой секрет отвергается', async () => {
    const t = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(t, OTHER, NOW)).toBe(false);
  });
  it('истёкший токен отвергается, граница ровно exp', async () => {
    const t = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(t, SECRET, NOW + (SESSION_TTL_SECONDS - 1) * 1000)).toBe(true);
    expect(await verifySessionToken(t, SECRET, NOW + SESSION_TTL_SECONDS * 1000)).toBe(false);
  });
  it('изменённый payload или подпись отвергаются', async () => {
    const t = await createSessionToken(SECRET, NOW);
    const [p, s] = t.split('.');
    const forged = b64urlEncode(new TextEncoder().encode(JSON.stringify({ v: 2, uid: 1, role: 'owner', amr: 'pwd', iat: 0, exp: 9999999999 })));
    expect(await verifySessionToken(`${forged}.${s}`, SECRET, NOW)).toBe(false);
    expect(await verifySessionToken(`${p}.${s.slice(0, -2)}AA`, SECRET, NOW)).toBe(false);
  });
  it('мусор отвергается без исключений', async () => {
    for (const t of ['', 'abc', 'a.b.c', '.', 'a.', '.b', '!!!.???', null, undefined]) {
      expect(await verifySessionToken(t, SECRET, NOW)).toBe(false);
    }
  });
  it('fail closed: пустой/короткий секрет', async () => {
    await expect(createSessionToken('', NOW)).rejects.toThrow();
    await expect(createSessionToken('short', NOW)).rejects.toThrow();
    await expect(createSessionToken(undefined, NOW)).rejects.toThrow();
    const t = await createSessionToken(SECRET, NOW);
    expect(await verifySessionToken(t, '', NOW)).toBe(false);
    expect(await verifySessionToken(t, null, NOW)).toBe(false);
    expect(await verifySessionToken(t, 'short', NOW)).toBe(false);
  });
});

describe('сравнение секретов', () => {
  it('пароль: совпадение и несовпадение разной длины', () => {
    expect(checkPassword('correct horse battery', 'correct horse battery')).toBe(true);
    expect(checkPassword('correct horse', 'correct horse battery')).toBe(false);
    expect(checkPassword('x'.repeat(256), 'correct horse battery')).toBe(false);
    expect(secureEqual('', '')).toBe(true);
  });
  it('fail closed: пустой ожидаемый пароль никогда не совпадает', () => {
    expect(checkPassword('', '')).toBe(false);
    expect(checkPassword('', undefined)).toBe(false);
    expect(checkPassword('anything', null)).toBe(false);
  });
  it('Bearer: формат и fail closed', () => {
    expect(checkBearer(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(checkBearer(`Bearer ${OTHER}`, SECRET)).toBe(false);
    expect(checkBearer(SECRET, SECRET)).toBe(false);
    expect(checkBearer('Bearer ', SECRET)).toBe(false);
    expect(checkBearer(null, SECRET)).toBe(false);
    expect(checkBearer('Bearer ', '')).toBe(false);
    expect(checkBearer('Bearer x', undefined)).toBe(false);
  });
  it('hashIp: детерминирован, зависит от секрета, не содержит IP', () => {
    const h = hashIp('1.2.3.4', SECRET);
    expect(h).toBe(hashIp('1.2.3.4', SECRET));
    expect(h).not.toBe(hashIp('1.2.3.4', OTHER));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('env fail closed', () => {
  const good = { ADMIN_PASSWORD: 'p'.repeat(12), SESSION_SECRET: SECRET, CRON_SECRET: SECRET };
  it('валидные значения', () => {
    expect(getAuthEnv(good)).toEqual({ adminPassword: good.ADMIN_PASSWORD, sessionSecret: SECRET });
    expect(getCronSecret(good)).toBe(SECRET);
    expect(getSessionSecret(good)).toBe(SECRET);
  });
  it('пусто/коротко = null', () => {
    expect(getAuthEnv({})).toBeNull();
    expect(getAuthEnv({ ...good, ADMIN_PASSWORD: '' })).toBeNull();
    expect(getAuthEnv({ ...good, ADMIN_PASSWORD: 'p'.repeat(11) })).toBeNull();
    expect(getAuthEnv({ ...good, SESSION_SECRET: 'a'.repeat(31) })).toBeNull();
    expect(getAuthEnv({ ...good, SESSION_SECRET: undefined })).toBeNull();
    expect(getCronSecret({})).toBeNull();
    expect(getCronSecret({ CRON_SECRET: '' })).toBeNull();
    expect(getCronSecret({ CRON_SECRET: 'short' })).toBeNull();
    expect(getSessionSecret({ SESSION_SECRET: '' })).toBeNull();
  });
});

describe('лимитер входа', () => {
  const now = new Date(NOW);
  const ago = (min: number) => new Date(NOW - min * 60_000);

  it('4 неудачи не блокируют, 5 блокируют', () => {
    const four = [1, 2, 3, 4].map(ago);
    expect(evaluateLimit(four, four, now)).toEqual({ limited: false });
    const five = [1, 2, 3, 4, 5].map(ago);
    expect(evaluateLimit(five, five, now).limited).toBe(true);
  });
  it('Retry-After = до выпадения старейшей попытки из окна', () => {
    const five = [10, 8, 6, 4, 2].map(ago);
    const r = evaluateLimit(five, five, now);
    expect(r).toEqual({ limited: true, retryAfterSeconds: 5 * 60 });
  });
  it('попытки старше 15 минут не считаются для IP', () => {
    const old = [16, 17, 18, 19, 20].map(ago);
    expect(evaluateLimit(old, old, now)).toEqual({ limited: false });
  });
  it('20 неудач за час с разных IP больше не закрывают вход (лимит по IP)', () => {
    const all = Array.from({ length: 20 }, (_, i) => ago(i * 2 + 1));
    expect(evaluateLimit([], all, now)).toEqual({ limited: false });
    expect(evaluateLimit([1, 2, 3, 4, 5].map(ago), all, now).limited).toBe(true);
  });
  it('глобальный потолок не закрывает вход: сверх max одна попытка на всех раз в throttleMs (P2-9)', () => {
    const t = GLOBAL_LIMIT.throttleMs!;
    // max неудач за час с разных IP, последняя только что: следующая ждёт throttleMs
    const all = Array.from({ length: GLOBAL_LIMIT.max }, (_, i) => new Date(NOW - 1000 - i * 10_000));
    expect(evaluateLimit([], all, now)).toEqual({ limited: true, retryAfterSeconds: Math.ceil((t - 1000) / 1000) });
    // через throttleMs после последней попытка проходит, хотя потолок ещё превышен
    expect(evaluateLimit([], all, new Date(NOW - 1000 + t))).toEqual({ limited: false });
    // и даже при 10×max (массовая ротация) Retry-After не больше throttleMs
    const flood = Array.from({ length: GLOBAL_LIMIT.max * 10 }, (_, i) => new Date(NOW - i * 1000));
    const r = evaluateLimit([], flood, now);
    expect(r.limited && r.retryAfterSeconds).toBe(t / 1000);
    expect(evaluateLimit([], all.slice(1), now)).toEqual({ limited: false });
  });
  it('лимит по IP при этом остаётся жёстким: больший Retry-After', () => {
    const ip = [14, 13, 12, 11, 10].map(ago);
    const all = Array.from({ length: GLOBAL_LIMIT.max }, (_, i) => new Date(NOW - i * 1000));
    const r = evaluateLimit(ip, all, now);
    expect(r.limited && r.retryAfterSeconds).toBe(60);
  });
  it('NPSSO: глобальный потолок по-прежнему блокирует (только owner)', () => {
    const all = Array.from({ length: NPSSO_RULES.global.max }, (_, i) => ago(1 + i));
    expect(evaluateLimit([], all, now, NPSSO_RULES).limited).toBe(true);
    expect(NPSSO_RULES.global.throttleMs).toBeUndefined();
  });
});

describe('safeNext', () => {
  it('разрешает только относительные пути', () => {
    expect(safeNext('/games?x=1')).toBe('/games?x=1');
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'evil', '', undefined, 5, '/a\nb']) {
      expect(safeNext(bad)).toBe('/');
    }
  });
});
