'use client';

/**
 * Общий запрос GET /api/auth/me для useMe, useIsOwner и снапшота профилей: одновременные вызовы делят один fetch
 * (на загрузке страницы было три одинаковых запроса). Результат между загрузками не кэшируется: промис живёт, пока идёт запрос.
 * null = сбой сети; иначе код ответа и разобранное тело (null, если не JSON). Тело всегда дочитывается.
 */
export type AuthMeRaw = { status: number; json: { ok?: boolean; data?: Record<string, unknown>; error?: { code?: string } } | null } | null;

let inflight: Promise<AuthMeRaw> | null = null;

export function fetchAuthMe(): Promise<AuthMeRaw> {
  if (!inflight) {
    inflight = fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (r) => ({ status: r.status, json: (await r.json().catch(() => null)) as NonNullable<AuthMeRaw>['json'] }))
      .catch(() => null)
      .finally(() => { inflight = null; });
  }
  return inflight;
}
