// Клиент профилей PSN (контракт docs/api-contract.md, Фаза 41, 41.3). Типы свои: рантайм из src/server не импортируем.
import type { ApiFail } from './model';

export type LightProfile = { id: number; onlineId: string | null; isPrimary: boolean };
export type Profile = {
  id: number; isPrimary: boolean; onlineId: string | null; accessStatus: string; onboardedAt: string | null;
  canStartSync: boolean; gamesCount: number; lastSyncAt: string | null;
};
export type ArchivedProfile = { id: number; onlineId: string | null; archivedAt: string; purgeAt: string };
export type ProfilesList = {
  loginId: number; activeProfileId: number; limit: number; canAdd: boolean; profiles: Profile[]; archived: ArchivedProfile[];
};
export type AuthSnapshot = { activeProfileId: number; loginId: number; profiles: LightProfile[] };

export class ProfilesApiError extends Error implements ApiFail {
  constructor(public status: number, public code: string, public retryAfterSec?: number) {
    super(code);
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const ADD_TIMEOUT_MS = 30_000;

async function req<T>(url: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const ac = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ac.abort(), timeoutMs) : null;
  const outer = init?.signal;
  const onOuter = () => ac.abort();
  outer?.addEventListener('abort', onOuter);
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init, signal: ac.signal });
  } catch {
    if (outer?.aborted) throw new DOMException('aborted', 'AbortError');
    throw new ProfilesApiError(0, 'network');
  } finally {
    if (timer) clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: unknown; error?: { code?: string; details?: { retryAfterSec?: unknown } } }
    | null;
  if (res.status === 401 && typeof window !== 'undefined') {
    // полная перезагрузка: сброс клиентского состояния на странице входа
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
  if (!res.ok || !json?.ok) {
    const fromBody = json?.error?.details?.retryAfterSec;
    const header = Number(res.headers.get('Retry-After'));
    const n = typeof fromBody === 'number' ? fromBody : header;
    throw new ProfilesApiError(res.status, json?.error?.code ?? 'unknown', Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined);
  }
  return json.data as T;
}

export const fetchProfiles = (signal?: AbortSignal) => req<ProfilesList>('/api/me/profiles', { signal });

export const addProfile = (onlineId: string, activate: boolean) =>
  req<{ profile: Profile; activeProfileId: number; restored?: boolean }>(
    '/api/me/profiles', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ onlineId, activate }) }, ADD_TIMEOUT_MS,
  );

export const setActiveProfile = (profileId: number) =>
  req<{ activeProfileId: number; profile: Profile }>('/api/me/profiles/active', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ profileId }),
  });

export const unlinkProfile = (id: number, confirmOnlineId: string, purge: boolean) =>
  req<{ archived?: true; purged?: true; activeProfileId: number }>(`/api/me/profiles/${id}`, {
    method: 'DELETE', headers: JSON_HEADERS, body: JSON.stringify(purge ? { confirmOnlineId, purge: true } : { confirmOnlineId }),
  });

/** Лёгкие данные для шапки: активный профиль и список (GET /api/auth/me, 41.3). null = не удалось (сбой не показываем). */
export async function fetchAuthSnapshot(signal?: AbortSignal): Promise<AuthSnapshot | null> {
  try {
    const d = await req<{ activeProfileId?: unknown; loginId?: unknown; profiles?: unknown }>('/api/auth/me', { signal });
    if (typeof d.activeProfileId !== 'number') return null;
    const profiles = Array.isArray(d.profiles)
      ? (d.profiles as unknown[]).flatMap((p): LightProfile[] => {
        const o = p as { id?: unknown; onlineId?: unknown; isPrimary?: unknown };
        return typeof o?.id === 'number'
          ? [{ id: o.id, onlineId: typeof o.onlineId === 'string' ? o.onlineId : null, isPrimary: o.isPrimary === true }]
          : [];
      })
      : [];
    return { activeProfileId: d.activeProfileId, loginId: typeof d.loginId === 'number' ? d.loginId : d.activeProfileId, profiles };
  } catch {
    return null;
  }
}
