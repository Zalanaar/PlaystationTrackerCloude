// F2-B (пакет 3): ключ названия для точного сопоставления игры с индексом гайдов. Чистая функция (сервер и тесты).
// Только точное равенство ключей: префиксы и «похожие» названия никогда не сопоставляются автоматически.

const ROMAN: Record<string, string> = {
  ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12', xiii: '13', xv: '15', xvi: '16',
};
/** Слова, которые не различают игры в названиях PSN и PowerPyx (платформа, издание, служебные слова). */
const STRIP = /\b(ps4|ps5|playstation ?[45]|playstation|and|digital|deluxe|edition|standard|ultimate|complete|goty|game of the year|directors cut|remastered|remaster|remake|definitive|enhanced|the|of|for|cross gen|bundle|version|ps4 ps5)\b/g;

export function guideKey(title: string): string {
  let t = title.replace(/[™®©]/g, '').replace(/[’‘`]/g, "'").replace(/Δ/g, 'delta');
  t = t.normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase();
  t = t.replace(/\(.*?\)/g, ' ').replace(/'/g, '');
  t = t.replace(/[^a-z0-9 ]+/g, ' ');
  t = t.split(/\s+/).filter(Boolean).map((w) => ROMAN[w] ?? w).join(' ');
  t = t.replace(STRIP, ' ');
  return t.split(/\s+/).filter(Boolean).join(' ');
}

/** DLC в индексе не сопоставляются с играми. */
export const isDlcTitle = (title: string): boolean => /\bdlc\b/i.test(title);
