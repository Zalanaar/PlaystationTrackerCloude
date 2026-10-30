// Единое детерминированное сравнение строк для тай-брейков (не зависит от локали/ICU, одинаково в Node и браузере).
// Общее для сервера и UI. Порядок: нижний регистр, «ё» как «е» (при равенстве «е» < «ё»), затем по кодовым единицам UTF-16.

/** Сравнение строк по toLowerCase через < / >. Без localeCompare. */
export function compareText(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  // «ё» (U+0451) по кодовым единицам лежит после «я»: сравниваем как «е», а при равенстве «е» < «ё».
  const fx = x.replace(/ё/g, 'е');
  const fy = y.replace(/ё/g, 'е');
  if (fx !== fy) return fx < fy ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Тай-брейк «название, затем id» для сортировок статистики, Wrapped и коллекции. */
export function compareTitleId(a: { title: string; id: number }, b: { title: string; id: number }): number {
  return compareText(a.title, b.title) || a.id - b.id;
}
