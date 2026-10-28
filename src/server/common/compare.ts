// Единое детерминированное сравнение для тай-брейков (не зависит от локали/ICU, одинаково в Node и браузере).
// Порядок: заголовок в нижнем регистре по кодовым единицам UTF-16 (< / >), затем id.

/** Сравнение строк по toLowerCase через < / >. Без localeCompare. */
export function compareText(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Тай-брейк «название, затем id» для сортировок статистики, Wrapped и коллекции. */
export function compareTitleId(a: { title: string; id: number }, b: { title: string; id: number }): number {
  return compareText(a.title, b.title) || a.id - b.id;
}
