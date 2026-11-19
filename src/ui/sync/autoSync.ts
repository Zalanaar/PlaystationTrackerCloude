// Идея 1 (аудит UX): автосинк при открытии. Клиент только предлагает: данные старше 6 ч, синк не идёт, PSN не требует
// нового NPSSO, вкладка видна, и с этого устройства не просили последние 30 мин (несколько вкладок/возвратов подряд).
// Решение и лимит «не чаще раза в 6 ч на профиль» — на сервере (POST /api/sync/auto).
import { needsNewNpsso, type SyncStatus } from './status';

export const AUTO_STALE_MS = 6 * 3600_000;
export const AUTO_ASK_GAP_MS = 30 * 60_000;
export const AUTO_KEY = 'ps-autosync-at';

export function shouldAskAutoSync(s: Pick<SyncStatus, 'lastSuccessAt' | 'running' | 'psnAuth' | 'run'>, now: number, lastAskAt: number | null): boolean {
  if (!s.lastSuccessAt || s.running || needsNewNpsso(s)) return false;
  const t = new Date(s.lastSuccessAt).getTime();
  if (!Number.isFinite(t) || now - t < AUTO_STALE_MS) return false;
  return lastAskAt === null || now - lastAskAt >= AUTO_ASK_GAP_MS;
}

const readAsk = (): number | null => {
  try { const v = Number(localStorage.getItem(AUTO_KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
};

/** true — сервер запустил синк (статус надо перечитать, начнётся опрос). */
export async function maybeAutoSync(s: SyncStatus, now = Date.now()): Promise<boolean> {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
  if (!shouldAskAutoSync(s, now, readAsk())) return false;
  try { localStorage.setItem(AUTO_KEY, String(now)); } catch { /* приватный режим: просто спросим сервер */ }
  try {
    const res = await fetch('/api/sync/auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return res.status === 202;
  } catch {
    return false;
  }
}
