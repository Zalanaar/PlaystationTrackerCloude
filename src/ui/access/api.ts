// Клиент API «Доступ» (контракт docs/api-contract.md 22.5) и /api/auth/me (22.4). Только типы из server.
import type { AccessUser } from '@/server/auth/users';

export type { AccessUser };
export type MeInfo = { id: number; email: string; displayName: string | null; role: 'owner' | 'member' };

export class AccessApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    throw new AccessApiError(0, 'network');
  }
  const json = await res.json().catch(() => null);
  if (res.status === 401 && typeof window !== 'undefined') {
    // полная перезагрузка: сброс клиентского состояния на странице входа
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
  if (!res.ok || !json?.ok) throw new AccessApiError(res.status, json?.error?.code ?? 'unknown');
  return json.data as T;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const fetchMe = (signal?: AbortSignal) => req<MeInfo>('/api/auth/me', { signal });
export const fetchAccessUsers = (signal?: AbortSignal) => req<{ users: AccessUser[] }>('/api/access/users', { signal }).then((d) => d.users);
export const addAccessUser = (email: string) =>
  req<{ user: AccessUser }>('/api/access/users', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ email }) });
export const setAccessStatus = (id: number, status: 'active' | 'blocked') =>
  req<{ user: AccessUser }>(`/api/access/users/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ status }) });
export const deleteAccessUser = (id: number, confirmEmail: string) =>
  req<{ deleted: true }>(`/api/access/users/${id}`, { method: 'DELETE', headers: JSON_HEADERS, body: JSON.stringify({ confirmEmail }) });
