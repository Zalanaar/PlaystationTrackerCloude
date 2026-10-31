import { describe, expect, it } from 'vitest';
import { createSessionTokenV2, readSessionToken, SESSION_TTL_SECONDS, signJson, verifyJson, verifySessionToken, b64urlEncode } from './session';
import { evaluateLimit, GOOGLE_RULES } from './limiter';

const SECRET = 's'.repeat(40);
const NOW = 1_800_000_000_000;
const enc = new TextEncoder();

async function forge(payload: object, secret = SECRET): Promise<string> {
  const p = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${p}.${b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(p))))}`;
}

describe('сессия v:2', () => {
  it('создаётся и читается: uid, role, amr, срок 30 дней', async () => {
    const t = await createSessionTokenV2(SECRET, { uid: 5, role: 'member', amr: 'google' }, NOW);
    const s = await readSessionToken(t, SECRET, NOW + 1000);
    expect(s).toMatchObject({ v: 2, uid: 5, role: 'member', amr: 'google' });
    expect(s!.exp - s!.iat).toBe(SESSION_TTL_SECONDS);
    expect(await verifySessionToken(t, SECRET, NOW)).toBe(true);
  });

  it('истёкший токен отвергается, за секунду до срока действует', async () => {
    const t = await createSessionTokenV2(SECRET, { uid: 2, role: 'member', amr: 'google' }, NOW);
    expect(await readSessionToken(t, SECRET, NOW + (SESSION_TTL_SECONDS - 1) * 1000)).not.toBeNull();
    expect(await readSessionToken(t, SECRET, NOW + SESSION_TTL_SECONDS * 1000)).toBeNull();
  });

  it('чужая подпись, подмена payload (повышение роли), другой секрет: null', async () => {
    const t = await createSessionTokenV2(SECRET, { uid: 2, role: 'member', amr: 'google' }, NOW);
    expect(await readSessionToken(t, 'x'.repeat(40), NOW)).toBeNull();
    const [p, sig] = t.split('.');
    const body = JSON.parse(Buffer.from(p, 'base64url').toString());
    const tampered = b64urlEncode(enc.encode(JSON.stringify({ ...body, role: 'owner' })));
    expect(await readSessionToken(`${tampered}.${sig}`, SECRET, NOW)).toBeNull();
    expect(await readSessionToken(`${p}.${sig}x`, SECRET, NOW)).toBeNull();
  });

  it('некорректная форма v:2 с верной подписью отвергается', async () => {
    const base = { v: 2, iat: NOW / 1000, exp: NOW / 1000 + 100 };
    for (const bad of [
      { ...base, uid: 0, role: 'owner', amr: 'pwd' },
      { ...base, uid: 1.5, role: 'owner', amr: 'pwd' },
      { ...base, uid: '1', role: 'owner', amr: 'pwd' },
      { ...base, uid: 1, role: 'admin', amr: 'pwd' },
      { ...base, uid: 1, role: 'owner', amr: 'sms' },
      { ...base, uid: 1, role: 'owner' },
      { ...base, v: 3, uid: 1, role: 'owner', amr: 'pwd' },
    ]) {
      expect(await readSessionToken(await forge(bad), SECRET, NOW)).toBeNull();
    }
  });

  it('пустой или короткий секрет: создание бросает, чтение null', async () => {
    await expect(createSessionTokenV2('short', { uid: 1, role: 'owner', amr: 'pwd' })).rejects.toThrow();
    await expect(createSessionTokenV2(SECRET, { uid: -1, role: 'owner', amr: 'pwd' })).rejects.toThrow();
    expect(await readSessionToken('a.b', null)).toBeNull();
  });
});

describe('v:1 удалён (после 0015, контракт 22.3)', () => {
  it('токен v:1 с верной подписью не принимается ни readSessionToken, ни verifySessionToken', async () => {
    const t = await forge({ v: 1, iat: NOW / 1000, exp: NOW / 1000 + 100 });
    expect(await readSessionToken(t, SECRET, NOW)).toBeNull();
    expect(await verifySessionToken(t, SECRET, NOW)).toBe(false);
    const withClaims = await forge({ v: 1, uid: 1, role: 'owner', amr: 'pwd', iat: NOW / 1000, exp: NOW / 1000 + 100 });
    expect(await readSessionToken(withClaims, SECRET, NOW)).toBeNull();
  });
});

describe('signJson / служебная cookie', () => {
  it('служебный JSON не принимается как сессия и наоборот не ломает проверку', async () => {
    const t = await signJson(SECRET, { t: 'oauth', state: 'x', exp: NOW / 1000 + 100 });
    expect(await verifyJson(SECRET, t)).toMatchObject({ t: 'oauth' });
    expect(await readSessionToken(t, SECRET, NOW)).toBeNull();
    expect(await verifyJson('y'.repeat(40), t)).toBeNull();
    const s = await createSessionTokenV2(SECRET, { uid: 1, role: 'owner', amr: 'pwd' }, NOW);
    expect((await verifyJson(SECRET, s))?.t).toBeUndefined();
  });
});

describe('лимит Google: 10 за 15 минут на IP, 40 за час глобально', () => {
  const now = new Date(NOW);
  const at = (minAgo: number) => new Date(NOW - minAgo * 60_000);
  it('9 неудач с IP: можно, 10: блок с Retry-After', () => {
    const nine = Array.from({ length: 9 }, (_, i) => at(i));
    expect(evaluateLimit(nine, nine, now, GOOGLE_RULES).limited).toBe(false);
    const ten = Array.from({ length: 10 }, (_, i) => at(i));
    const r = evaluateLimit(ten, ten, now, GOOGLE_RULES);
    expect(r.limited && r.retryAfterSeconds).toBeGreaterThan(0);
  });
  it('глобально 40 за час блокирует даже новый IP', () => {
    const all = Array.from({ length: 40 }, (_, i) => at(i));
    expect(evaluateLimit([], all, now, GOOGLE_RULES).limited).toBe(true);
    expect(evaluateLimit([], all.slice(1), now, GOOGLE_RULES).limited).toBe(false);
  });
  it('лимит пароля прежний (5/15 мин) по умолчанию', () => {
    const five = Array.from({ length: 5 }, (_, i) => at(i));
    expect(evaluateLimit(five, five, now).limited).toBe(true);
  });
});
