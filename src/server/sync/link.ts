// Fallback-сопоставление сирот-сетов с играми по имени (последний, наименее надёжный источник).

/** Нижний регистр, без ™®©, без пометок платформы и издания, без пунктуации. */
export function normalizeName(name: string): string {
  return name
    .replace(/[™®©]/g, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\(?\b(ps[345]|playstation ?[345]|ps vita|vita)\b\)?/g, ' ')
    .replace(/\b(trophies|trophy set|trophy|edition|game of the year|goty|remastered|definitive|deluxe|standard|digital)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export type NameLinkSet = { setId: number; name: string };
export type NameLinkGame = { gameId: number; name: string };

/** Однозначные пары (сет, игра): имя совпадает ровно с одной игрой. Остальное попадает в ambiguous. */
export function matchOrphansByName(sets: NameLinkSet[], gamesWithoutSets: NameLinkGame[]): {
  links: Array<{ setId: number; gameId: number }>;
  ambiguous: number[];
} {
  const byName = new Map<string, number[]>();
  for (const g of gamesWithoutSets) {
    const n = normalizeName(g.name);
    if (!n) continue;
    byName.set(n, [...(byName.get(n) ?? []), g.gameId]);
  }
  const links: Array<{ setId: number; gameId: number }> = [];
  const ambiguous: number[] = [];
  for (const s of sets) {
    const n = normalizeName(s.name);
    const hit = n ? byName.get(n) : undefined;
    if (!hit) continue;
    if (hit.length === 1) links.push({ setId: s.setId, gameId: hit[0] });
    else ambiguous.push(s.setId);
  }
  return { links, ambiguous };
}
