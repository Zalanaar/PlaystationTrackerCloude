// Клиент GET /api/health/overview (контракт F35.1). Только типы из server.
import type { HealthOverview } from './model';

export class HealthApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function fetchHealthOverview(signal?: AbortSignal): Promise<HealthOverview> {
  let res: Response;
  try {
    res = await fetch('/api/health/overview', { cache: 'no-store', signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new HealthApiError(0, 'network');
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: HealthOverview; error?: { code?: string } } | null;
  if (res.status === 401 && typeof window !== 'undefined') {
    // полная перезагрузка: сброс клиентского состояния на странице входа
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
  if (!res.ok || !json?.ok || !json.data) throw new HealthApiError(res.status, json?.error?.code ?? 'unknown');
  return json.data;
}
