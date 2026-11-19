// П15.6: запросы онбординга (общие для шагов «Ник» и «Загрузка»).
import type { PsnState } from './model';

export const JSON_HEADERS = { 'Content-Type': 'application/json' };
export const POLL_MS = 2500;

export function goLogin() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign('/login?next=%2Fonboarding');
}

export async function fetchPsn(): Promise<PsnState | null> {
  try {
    const res = await fetch('/api/me/psn', { cache: 'no-store' });
    if (res.status === 401) { goLogin(); return null; }
    const json = await res.json().catch(() => null);
    return res.ok && json?.ok ? (json.data as PsnState) : null;
  } catch {
    return null;
  }
}
