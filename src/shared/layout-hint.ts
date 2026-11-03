/**
 * Подсказка раскладки Коллекции для серверного рендера (item 4, CLS): вид сетки, развёрнут ли «Ближе к платине», ширина окна,
 * день, на который скрыта полоса «С прошлого визита». Сервер рисует первый экран с играми; без подсказки вид, число колонок превью,
 * свёрнутость блока и полоса менялись бы после гидрации (сдвиг). Клиент запоминает фактические значения в cookie, сервер читает их.
 * Не секрет и не права: только снимок локальных настроек.
 */
export const LAYOUT_HINT_COOKIE = 'ps-layout';

/** day: дата МСК (YYYY-MM-DD), на которую полоса скрыта («Скрыть на сегодня»). */
export type LayoutHint = { view?: string; near?: boolean; width?: number; day?: string };

const VIEW_RE = /^[a-z]{1,12}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `view.near.width.day`, например `cards.0.390.` или `list.1.1440.2026-11-03`. Мусор → пустая подсказка (прежние значения по умолчанию). */
export function parseLayoutHint(v: string | undefined): LayoutHint {
  if (!v) return {};
  const [view, near, width, day] = v.split('.');
  const out: LayoutHint = {};
  if (view && VIEW_RE.test(view)) out.view = view;
  if (near === '1' || near === '0') out.near = near === '1';
  const w = Number(width);
  if (width && Number.isInteger(w) && w >= 240 && w <= 8192) out.width = w;
  if (day && DAY_RE.test(day)) out.day = day;
  return out;
}

export function formatLayoutHint(h: { view: string; near: boolean; width: number; day?: string | null }): string {
  return `${VIEW_RE.test(h.view) ? h.view : ''}.${h.near ? 1 : 0}.${Math.round(h.width)}.${h.day && DAY_RE.test(h.day) ? h.day : ''}`;
}

/** Строка для document.cookie: на год, весь сайт. */
export function layoutHintCookie(value: string): string {
  return `${LAYOUT_HINT_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
}
