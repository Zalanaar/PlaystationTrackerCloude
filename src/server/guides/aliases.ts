// F2-B (пакет 3): названия, под которыми PowerPyx держит гайд иначе, чем PSN. Ключ — guideKey(название PSN),
// значение — guideKey(название в индексе). Только проверенные пары (03.11.2026), без «похожих» совпадений.
import { guideKey } from '@/shared/guide-key';

const PAIRS: readonly [psn: string, powerpyx: string][] = [
  ['Resident Evil Village', 'Resident Evil 8 Village'],
  ['Resident Evil Requiem', 'Resident Evil 9 Requiem'],
  ["Assassin's Creed Black Flag Resynced", 'Assassin’s Creed 4 Black Flag Resynced'],
  ['METAL GEAR SOLID Δ: SNAKE EATER', 'Metal Gear Solid 3 Delta: Snake Eater (Remake)'],
];

export const GUIDE_ALIASES: ReadonlyMap<string, string> = new Map(PAIRS.map(([a, b]) => [guideKey(a), guideKey(b)]));

/** Ключи для поиска в индексе: сам ключ и (если есть) алиас. */
export function lookupKeys(title: string): string[] {
  const k = guideKey(title);
  if (!k) return [];
  const a = GUIDE_ALIASES.get(k);
  return a && a !== k ? [k, a] : [k];
}
