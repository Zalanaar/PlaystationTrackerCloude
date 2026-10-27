// Календарные даты по Europe/Moscow (контракт 1.6). Без DST, но считаем через Intl, а не фиксированным смещением.
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Дата YYYY-MM-DD по Москве для момента времени. */
export function mskDate(d: Date): string {
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
