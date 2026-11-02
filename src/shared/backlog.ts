// Фаза 48 (п. 11): подписи единого числа «бэклог». Само число считает сервер (`countBacklog`, `backlogGameWhere`):
// видимые игры библиотеки со статусом «Бэклог», без скрытых (в том числе скрытых PS PC) и дублей.
// Экраны показывают это число как есть; всё, что не совпадает с ним, подписывают отдельно от него.

const ru = (n: number, f: readonly [string, string, string]): string => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return f[2];
  if (b === 1) return f[0];
  if (b >= 2 && b <= 4) return f[1];
  return f[2];
};

/** Что считается бэклогом: для подсказок (title) у числа. */
export const BACKLOG_DEFINITION = 'Игры библиотеки со статусом «Бэклог». Скрытые игры и дубли не считаются.';

/** «64 игры в бэклоге». */
export function backlogTotalText(total: number): string {
  return `${total} ${ru(total, ['игра', 'игры', 'игр'])} в бэклоге`;
}

/** Записи «вручную» (Фаза 43) идут сверх числа бэклога: «ещё 5 вручную, из них 3 не куплено». Пусто, если записей нет. */
export function backlogManualText(manual: number, notPurchased: number): string {
  if (manual <= 0) return '';
  const np = notPurchased > 0 ? `, из них ${notPurchased} не куплено` : '';
  return `ещё ${manual} ${ru(manual, ['запись', 'записи', 'записей'])} вручную${np}`;
}

/** «Подскажи»: кандидаты = бэклог минус «Не предлагать». total не пришёл (старый сервер) = без уточнения. */
export function recommendPoolText(candidates: number, total: number | null | undefined): string {
  const base = `Из ${candidates} ${ru(candidates, ['игры', 'игр', 'игр'])} бэклога по твоей истории`;
  const off = typeof total === 'number' ? total - candidates : 0;
  return off > 0 ? `${base} · ещё ${off} ${ru(off, ['скрыта', 'скрыты', 'скрыто'])} через «Не предлагать»` : base;
}

/** «План»: сколько из бэклога в очереди и сколько убрано из плана. total не пришёл = пусто. */
export function roadmapBacklogText(total: number | null | undefined, excluded: number): string {
  if (typeof total !== 'number') return '';
  const inQueue = Math.max(0, total - excluded);
  const ex = excluded > 0 ? `, ${excluded} ${ru(excluded, ['убрана', 'убраны', 'убрано'])} из плана` : '';
  return `${backlogTotalText(total)}: ${inQueue} в очереди${ex}`;
}
