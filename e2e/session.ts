import { createHmac } from 'node:crypto';
import { E2E_ENV } from './env';

/** Токен сессии v:2 владельца (uid 1, pwd) по контракту 22.3; secret/exp можно подменить для негативных кейсов. */
export async function signedSession(opts: { secret?: string; iat?: number; exp?: number; uid?: number; role?: 'owner' | 'member' } = {}): Promise<string> {
  const iat = opts.iat ?? Math.floor(Date.now() / 1000);
  const exp = opts.exp ?? iat + 3600;
  const payload = Buffer.from(JSON.stringify({ v: 2, uid: opts.uid ?? 1, role: opts.role ?? 'owner', amr: 'pwd', iat, exp })).toString('base64url');
  const sig = createHmac('sha256', opts.secret ?? E2E_ENV.SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
