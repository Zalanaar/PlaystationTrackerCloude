import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { buildAuthUrl, exchangeCode, GoogleAuthError, newOAuthState, pkceChallenge, readOAuthCookie, resetJwksCache, signOAuthCookie, stateMatches, verifyIdToken, type GoogleDeps } from './google';
import { createSessionTokenV2 } from './session';

const SECRET = 's'.repeat(40);
const CLIENT = 'client-id.apps.googleusercontent.com';
const NOW = 1_800_000_000_000;

export const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

function idToken(claims: Record<string, unknown>, opts: { kid?: string; key?: typeof pair.privateKey; alg?: string } = {}): string {
  const h = Buffer.from(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' })).toString('base64url');
  const c = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = createSign('RSA-SHA256').update(`${h}.${c}`).sign(opts.key ?? pair.privateKey).toString('base64url');
  return `${h}.${c}.${sig}`;
}
const good = (over: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com', aud: CLIENT, sub: 'sub-1', email: 'a@x.com', email_verified: true, nonce: 'N', exp: NOW / 1000 + 600, ...over,
});
const deps = (keys = [jwk]): GoogleDeps & { fetch: ReturnType<typeof vi.fn> } => ({
  fetch: vi.fn(async () => new Response(JSON.stringify({ keys }), { status: 200 })),
  now: () => NOW,
});
const expectCode = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(GoogleAuthError);
  expect((e as GoogleAuthError).code).toBe(code);
};

beforeEach(() => resetJwksCache());

describe('verifyIdToken', () => {
  it('валидный токен: sub, email, name', async () => {
    const id = await verifyIdToken(idToken(good({ name: 'Ann' })), { clientId: CLIENT, nonce: 'N' }, deps());
    expect(id).toEqual({ sub: 'sub-1', email: 'a@x.com', name: 'Ann' });
  });
  it('iss без префикса https тоже допустим', async () => {
    await expect(verifyIdToken(idToken(good({ iss: 'accounts.google.com' })), { clientId: CLIENT, nonce: 'N' }, deps())).resolves.toBeTruthy();
  });
  it.each([
    ['чужой iss', { iss: 'https://evil.example' }],
    ['чужой aud', { aud: 'other' }],
    ['истёк', { exp: NOW / 1000 - 1 }],
    ['другой nonce', { nonce: 'X' }],
    ['нет sub', { sub: undefined }],
  ])('%s: token', async (_n, over) => {
    await expectCode(verifyIdToken(idToken(good(over)), { clientId: CLIENT, nonce: 'N' }, deps()), 'token');
  });
  it('email_verified=false или нет: unverified', async () => {
    await expectCode(verifyIdToken(idToken(good({ email_verified: false })), { clientId: CLIENT, nonce: 'N' }, deps()), 'unverified');
    await expectCode(verifyIdToken(idToken(good({ email_verified: undefined })), { clientId: CLIENT, nonce: 'N' }, deps()), 'unverified');
  });
  it('подпись другим ключом, alg none/HS256, неизвестный kid, мусор: token', async () => {
    const o = { clientId: CLIENT, nonce: 'N' };
    await expectCode(verifyIdToken(idToken(good(), { key: other.privateKey }), o, deps()), 'token');
    await expectCode(verifyIdToken(idToken(good(), { alg: 'none' }), o, deps()), 'token');
    await expectCode(verifyIdToken(idToken(good(), { alg: 'HS256' }), o, deps()), 'token');
    await expectCode(verifyIdToken(idToken(good(), { kid: 'nope' }), o, deps()), 'token');
    await expectCode(verifyIdToken('a.b', o, deps()), 'token');
  });
  it('ротация ключей: неизвестный kid перезапрашивает JWKS один раз', async () => {
    const d = deps();
    await verifyIdToken(idToken(good()), { clientId: CLIENT, nonce: 'N' }, d);
    await expectCode(verifyIdToken(idToken(good(), { kid: 'new' }), { clientId: CLIENT, nonce: 'N' }, d), 'token');
    expect(d.fetch).toHaveBeenCalledTimes(2);
  });
  it('JWKS недоступен: network', async () => {
    const d: GoogleDeps = { fetch: vi.fn(async () => { throw new Error('down'); }), now: () => NOW };
    await expectCode(verifyIdToken(idToken(good()), { clientId: CLIENT, nonce: 'N' }, d), 'network');
  });
});

describe('exchangeCode', () => {
  const cfg = { clientId: CLIENT, clientSecret: 'sec', origin: 'https://app.example' };
  it('шлёт code, verifier, redirect_uri, client_secret на сервер; возвращает id_token', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id_token: 'T' }), { status: 200 }));
    expect(await exchangeCode(cfg, 'CODE', 'VER', { fetch: f, now: () => NOW })).toBe('T');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const p = init.body as URLSearchParams;
    expect(p.get('code_verifier')).toBe('VER');
    expect(p.get('redirect_uri')).toBe('https://app.example/api/auth/google/callback');
    expect(p.get('grant_type')).toBe('authorization_code');
  });
  it('ошибка Google, нет id_token, сеть', async () => {
    await expectCode(exchangeCode(cfg, 'c', 'v', { fetch: async () => new Response('{}', { status: 400 }), now: () => NOW }), 'exchange');
    await expectCode(exchangeCode(cfg, 'c', 'v', { fetch: async () => new Response('{}', { status: 200 }), now: () => NOW }), 'exchange');
    await expectCode(exchangeCode(cfg, 'c', 'v', { fetch: async () => { throw new Error('x'); }, now: () => NOW }), 'network');
  });
});

describe('PKCE, state, cookie pst_oauth', () => {
  it('URL содержит S256, state, nonce, scope, prompt', () => {
    const s = newOAuthState('/games');
    const u = new URL(buildAuthUrl({ clientId: CLIENT, origin: 'https://app.example' }, s));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('code_challenge')).toBe(pkceChallenge(s.verifier));
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe(s.state);
    expect(u.searchParams.get('nonce')).toBe(s.nonce);
    expect(u.searchParams.get('scope')).toBe('openid email');
    expect(u.searchParams.get('prompt')).toBe('select_account');
    expect(u.searchParams.get('redirect_uri')).toBe('https://app.example/api/auth/google/callback');
    expect(newOAuthState('/').state).not.toBe(s.state);
  });
  it('PKCE по RFC 7636 (пример из приложения B)', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('cookie: круг, истечение, подпись, чужой тип', async () => {
    const s = newOAuthState('/x');
    const c = await signOAuthCookie(SECRET, s, NOW);
    expect(await readOAuthCookie(SECRET, c, NOW + 1000)).toEqual(s);
    expect(await readOAuthCookie(SECRET, c, NOW + 601_000)).toBeNull();
    expect(await readOAuthCookie('z'.repeat(40), c, NOW)).toBeNull();
    expect(await readOAuthCookie(SECRET, await createSessionTokenV2(SECRET, { uid: 1, role: 'owner', amr: 'pwd' }, NOW), NOW)).toBeNull();
    expect(await readOAuthCookie(SECRET, undefined, NOW)).toBeNull();
  });
  it('stateMatches: равенство, пусто, другое', () => {
    expect(stateMatches('abc', 'abc')).toBe(true);
    expect(stateMatches('abc', 'abd')).toBe(false);
    expect(stateMatches('abc', null)).toBe(false);
  });
});
