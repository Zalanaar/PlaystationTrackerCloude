import { createHmac } from 'node:crypto';
import { E2E_ENV } from './env';

/** Токен сессии по контракту 3.1; secret/exp можно подменить для негативных кейсов. */
export async function signedSession(opts: { secret?: string; iat?: number; exp?: number } = {}): Promise<string> {
  const iat = opts.iat ?? Math.floor(Date.now() / 1000);
  const exp = opts.exp ?? iat + 3600;
  const payload = Buffer.from(JSON.stringify({ v: 1, iat, exp })).toString('base64url');
  const sig = createHmac('sha256', opts.secret ?? E2E_ENV.SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
