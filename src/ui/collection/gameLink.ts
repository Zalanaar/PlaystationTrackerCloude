// Ссылка на игру `/?game=<id>[&tab=trophies]` (docs/design-system.md §8.6). Чистая часть: разбор и сборка адресов.

export type GameParam = { kind: 'none' } | { kind: 'invalid' } | { kind: 'ok'; id: number };
export type GameLinkTab = 'overview' | 'trophies';

type ParamsLike = { get(name: string): string | null };

/** `game` в query: нет параметра, неверный формат (не положительное целое) или id. */
export function parseGameParam(raw: string | null): GameParam {
  if (raw === null) return { kind: 'none' };
  if (!/^[1-9]\d{0,9}$/.test(raw)) return { kind: 'invalid' };
  const id = Number(raw);
  return Number.isSafeInteger(id) && id <= 2_147_483_647 ? { kind: 'ok', id } : { kind: 'invalid' };
}

export function parseGameTab(params: ParamsLike): GameLinkTab {
  return params.get('tab') === 'trophies' ? 'trophies' : 'overview';
}

/** Адрес Коллекции с открытой игрой: остальные параметры сохраняются, `tab` сбрасывается. */
export function gameHref(search: string, id: number, tab?: GameLinkTab): string {
  const p = new URLSearchParams(search);
  p.set('game', String(id));
  if (tab === 'trophies') p.set('tab', 'trophies');
  else p.delete('tab');
  return `/?${p.toString()}`;
}

/** Тот же адрес без `game` и `tab`. */
export function closedHref(pathname: string, search: string): string {
  const p = new URLSearchParams(search);
  p.delete('game');
  p.delete('tab');
  const qs = p.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export const GAME_NOT_FOUND_TEXT = 'Игра не найдена. Возможно, ссылка устарела.';
