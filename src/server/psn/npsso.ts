// Вставка NPSSO с сайта (контракт 27.1). NPSSO живёт только в аргументах и локальных переменных: не хранится, не логируется,
// не попадает в сообщения ошибок. Результат обмена шифруется и сохраняется одной записью psn_auth.
import type { AnyDb } from '@/db/types';
import { defaultAuthApi, saveTokens, type AuthApi } from './auth';
import { recordTokenEvent } from './token-events';

const NPSSO_RE = /^[A-Za-z0-9]{64}$/;

/** Принимает чистое значение или JSON `{"npsso":"..."}` с ca.account.sony.com/api/v1/ssocookie; null = неверный формат. */
export function normalizeNpsso(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 512) return null;
  let s = raw.trim();
  if (s.startsWith('{')) {
    try {
      const v = (JSON.parse(s) as { npsso?: unknown } | null)?.npsso;
      if (typeof v !== 'string') return null;
      s = v.trim();
    } catch {
      return null;
    }
  }
  s = s.replace(/^["']+|["']+$/g, '').trim();
  return NPSSO_RE.test(s) ? s : null;
}

export type PasteResult = { kind: 'ok'; refreshExpiresAt: Date | null } | { kind: 'rejected' };

/** null от PSN = rejected. Временные сбои бросает как PsnError (rate_limited / psn_unavailable); прежние токены не затираются. */
export async function pasteNpsso(
  db: AnyDb,
  o: { npsso: string; encryptionKey: string; userId: number; now?: Date; api?: AuthApi },
): Promise<PasteResult> {
  const now = o.now ?? new Date();
  const pair = await (o.api ?? defaultAuthApi).exchangeNpsso(o.npsso);
  if (!pair) return { kind: 'rejected' };
  await saveTokens(db, { encryptionKey: o.encryptionKey }, pair, 'npsso', now);
  await recordTokenEvent(db, 'pasted', { userId: o.userId, now, details: { refreshTokenExpiresInSec: pair.refreshTokenExpiresIn } });
  return { kind: 'ok', refreshExpiresAt: pair.refreshTokenExpiresIn > 0 ? new Date(now.getTime() + pair.refreshTokenExpiresIn * 1000) : null };
}
