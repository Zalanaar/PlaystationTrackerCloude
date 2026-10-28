// Разбор query GET /api/wrapped (контракт 11.1). Чистая функция.
export type WrappedParsed = { ok: true; value: { year: number } } | { ok: false; message: string };

export function parseWrappedQuery(sp: URLSearchParams, currentYear: number): WrappedParsed {
  const raw = sp.get('year');
  if (raw === null || raw === '') return { ok: true, value: { year: currentYear } };
  if (!/^\d{1,5}$/.test(raw)) return { ok: false, message: 'Некорректный год.' };
  const y = Number(raw);
  if (y < 2000 || y > 2100) return { ok: false, message: 'Некорректный год.' };
  return { ok: true, value: { year: y } };
}
