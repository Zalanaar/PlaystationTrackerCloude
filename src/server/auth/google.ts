// Google OAuth (контракт 22.4): PKCE S256, state, nonce, проверка id_token по JWKS Google. Только Node runtime.
// Токены и client_secret не логируются и не сохраняются.
import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto';
import type { webcrypto } from 'node:crypto';
type JsonWebKey = webcrypto.JsonWebKey;
import { secureEqual } from './password';
import { signJson, verifyJson } from './session';

export const OAUTH_COOKIE = 'pst_oauth';
export const OAUTH_COOKIE_PATH = '/api/auth/google';
export const OAUTH_TTL_SECONDS = 600;

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const HTTP_TIMEOUT_MS = 8000;

const b64u = (b: Buffer) => b.toString('base64url');

export type OAuthState = { state: string; nonce: string; verifier: string; next: string };

export function newOAuthState(next: string): OAuthState {
  return { state: b64u(randomBytes(32)), nonce: b64u(randomBytes(32)), verifier: b64u(randomBytes(48)), next };
}

export const pkceChallenge = (verifier: string) => b64u(createHash('sha256').update(verifier).digest());

export function buildAuthUrl(cfg: { clientId: string; origin: string }, s: OAuthState): string {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', `${cfg.origin}/api/auth/google/callback`);
  u.searchParams.set('scope', 'openid email');
  u.searchParams.set('state', s.state);
  u.searchParams.set('nonce', s.nonce);
  u.searchParams.set('code_challenge', pkceChallenge(s.verifier));
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

export function signOAuthCookie(secret: string, s: OAuthState, nowMs: number = Date.now()): Promise<string> {
  return signJson(secret, { t: 'oauth', ...s, exp: Math.floor(nowMs / 1000) + OAUTH_TTL_SECONDS });
}

/** null при неверной подписи, формате или сроке. Тип `t` отделяет эту cookie от сессионной. */
export async function readOAuthCookie(secret: string, token: string | undefined, nowMs: number = Date.now()): Promise<OAuthState | null> {
  const d = await verifyJson(secret, token);
  if (!d || d.t !== 'oauth') return null;
  const { state, nonce, verifier, next, exp } = d;
  if (typeof state !== 'string' || typeof nonce !== 'string' || typeof verifier !== 'string' || typeof next !== 'string' || typeof exp !== 'number') return null;
  if (Math.floor(nowMs / 1000) >= exp) return null;
  return { state, nonce, verifier, next };
}

export function stateMatches(a: string, b: string | null): boolean {
  return !!b && secureEqual(a, b);
}

export class GoogleAuthError extends Error {
  constructor(readonly code: 'exchange' | 'token' | 'unverified' | 'network') {
    super(code);
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type GoogleDeps = { fetch: FetchLike; now: () => number };
export const defaultDeps: GoogleDeps = { fetch: (i, init) => fetch(i, init), now: () => Date.now() };

/** Обмен code + code_verifier на id_token. */
export async function exchangeCode(
  cfg: { clientId: string; clientSecret: string; origin: string },
  code: string,
  verifier: string,
  deps: GoogleDeps = defaultDeps,
): Promise<string> {
  let res: Response;
  try {
    res = await deps.fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: `${cfg.origin}/api/auth/google/callback`,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    throw new GoogleAuthError('network');
  }
  if (!res.ok) throw new GoogleAuthError('exchange');
  try {
    const j = (await res.json()) as { id_token?: unknown };
    if (typeof j.id_token !== 'string' || !j.id_token) throw new Error();
    return j.id_token;
  } catch {
    throw new GoogleAuthError('exchange');
  }
}

type Jwk = JsonWebKey & { kid?: string; alg?: string };
let jwksCache: { keys: Jwk[]; at: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

export function resetJwksCache() {
  jwksCache = null;
}

async function loadJwks(deps: GoogleDeps, force: boolean): Promise<Jwk[]> {
  if (!force && jwksCache && deps.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  let res: Response;
  try {
    res = await deps.fetch(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS), cache: 'no-store' });
  } catch {
    throw new GoogleAuthError('network');
  }
  if (!res.ok) throw new GoogleAuthError('network');
  const j = (await res.json()) as { keys?: Jwk[] };
  if (!Array.isArray(j.keys)) throw new GoogleAuthError('network');
  jwksCache = { keys: j.keys, at: deps.now() };
  return j.keys;
}

export type GoogleIdentity = { sub: string; email: string; name: string | null };

/**
 * Проверка id_token: RS256 по ключу JWKS (kid), iss, aud, exp, nonce, email_verified === true.
 * Нарушение бросает GoogleAuthError('token'); неподтверждённый email — 'unverified' (в роуте это access_denied).
 */
export async function verifyIdToken(
  idToken: string,
  expect: { clientId: string; nonce: string },
  deps: GoogleDeps = defaultDeps,
): Promise<GoogleIdentity> {
  const bad = () => new GoogleAuthError('token');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw bad();
  let header: { alg?: unknown; kid?: unknown };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw bad();

  let keys = await loadJwks(deps, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await loadJwks(deps, true); // ротация ключей Google
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk || jwk.kty !== 'RSA') throw bad();
  let valid = false;
  try {
    valid = cryptoVerify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  } catch {
    throw bad();
  }
  if (!valid) throw bad();

  const nowS = Math.floor(deps.now() / 1000);
  const { iss, aud, exp, nonce, sub, email, email_verified: ev, name } = claims;
  if (typeof iss !== 'string' || !ISSUERS.has(iss)) throw bad();
  const audOk = typeof aud === 'string' ? aud === expect.clientId : Array.isArray(aud) && aud.length === 1 && aud[0] === expect.clientId;
  if (!audOk) throw bad();
  if (typeof exp !== 'number' || nowS >= exp) throw bad();
  if (typeof nonce !== 'string' || !secureEqual(nonce, expect.nonce)) throw bad();
  if (typeof sub !== 'string' || !sub || typeof email !== 'string' || !email) throw bad();
  if (ev !== true && ev !== 'true') throw new GoogleAuthError('unverified');
  return { sub, email, name: typeof name === 'string' ? name : null };
}
