'use client';

import { registerCacheReset } from '../profiles/scope';

/**
 * Общий запрос GET /api/auth/me для useMe, useIsOwner и снапшота профилей: одновременные вызовы делят один fetch
 * (на загрузке страницы было три одинаковых запроса). Успешный ответ ещё ME_REUSE_MS отдаётся тем, кто смонтировался позже
 * (компоненты под Suspense: на первой загрузке `/` второй запрос шёл через ~300 мс, повторный аудит P2-5).
 * Сбой (401, 5xx, сеть) отдаётся повторно только ME_FAIL_REUSE_MS: хуки, смонтированные в той же загрузке, не повторяют
 * запрос (флак collection-requests: первый ответ-ошибка приходил раньше, чем монтировался второй хук, и тот спрашивал заново).
 * `fresh: true` (перечитать после смены/привязки профиля) и смена профиля (resetClientCaches) этот короткий кэш обходят.
 * null = сбой сети; иначе код ответа и разобранное тело (null, если не JSON). Тело всегда дочитывается.
 */
export type AuthMeRaw = { status: number; json: { ok?: boolean; data?: Record<string, unknown>; error?: { code?: string } } | null } | null;

export const ME_REUSE_MS = 5000;
export const ME_FAIL_REUSE_MS = 1500;

let inflight: Promise<AuthMeRaw> | null = null;
let recent: { at: number; value: AuthMeRaw; ttl: number } | null = null;
registerCacheReset(() => { recent = null; });

export function fetchAuthMe(opts: { fresh?: boolean } = {}): Promise<AuthMeRaw> {
  if (opts.fresh) recent = null;
  else if (recent && Date.now() - recent.at < recent.ttl) return Promise.resolve(recent.value);
  if (!inflight) {
    const p: Promise<AuthMeRaw> = fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (r) => ({ status: r.status, json: (await r.json().catch(() => null)) as NonNullable<AuthMeRaw>['json'] }))
      .catch(() => null)
      .then((v) => {
        // успешный ответ — ME_REUSE_MS; сбой и 401 — коротко, только для той же загрузки страницы
        const good = !!v && v.status >= 200 && v.status < 300 && !!v.json?.ok;
        if (inflight === p) recent = { at: Date.now(), value: v, ttl: good ? ME_REUSE_MS : ME_FAIL_REUSE_MS };
        return v;
      })
      .finally(() => { if (inflight === p) inflight = null; });
    inflight = p;
  }
  return inflight;
}

/** Для тестов. */
export function resetAuthMeCache(): void {
  inflight = null;
  recent = null;
}
