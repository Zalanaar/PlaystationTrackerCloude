// Разбор query GET /api/wrapped (контракт 11.1). Чистая функция.
import { parseWithService } from '@/server/stats/validation';

export type WrappedParsed = { ok: true; value: { year: number | 'all'; withService?: boolean } } | { ok: false; message: string };

export function parseWrappedQuery(sp: URLSearchParams, currentYear: number): WrappedParsed {
  const ws = parseWithService(sp.get('withService'));
  if (ws === null) return { ok: false, message: 'Некорректный параметр withService.' };
  const extra = ws ? { withService: true } : {};
  const raw = sp.get('year');
  if (raw === null || raw === '') return { ok: true, value: { year: currentYear, ...extra } };
  // 26.2: год или строка all (регистр важен)
  if (raw === 'all') return { ok: true, value: { year: 'all', ...extra } };
  if (!/^\d{1,5}$/.test(raw)) return { ok: false, message: 'Некорректный год.' };
  const y = Number(raw);
  if (y < 2000 || y > 2100) return { ok: false, message: 'Некорректный год.' };
  return { ok: true, value: { year: y, ...extra } };
}
