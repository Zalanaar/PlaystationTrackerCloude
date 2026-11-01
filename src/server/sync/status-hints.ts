// Подсказки смены статуса (контракт 28). Чистая часть: решает по фактам об одной карточке (главной игре группы), без БД.
// Сайт только предлагает; статус меняет пользователь. Здесь нет записи ни в games, ни в game_status.
import {
  HINT_QUESTION,
  HINT_SUGGESTED,
  RECENT_LAUNCH_DAYS,
  STALE_PLAYING_DAYS,
  STATUS_HINT_RULES,
  type HintStatus,
  type StatusHintRule,
} from '@/shared/status-hints';

const DAY = 86_400_000;

/** Факты карточки: главная игра и её не скрытые дубли уже слиты (контракт 28.2). */
export type HintFacts = {
  gameId: number;
  /** null = без статуса. 'service' подсказок не получает. */
  status: 'playing' | 'completed' | 'dropped' | 'backlog' | 'shelved' | 'service' | null;
  statusChangedAt: Date | null;
  droppedAt: Date | null;
  /** максимум по группе */
  lastPlayedAt: Date | null;
  /** сумма по группе */
  playSeconds: number;
  platinumEarned: boolean;
  platinumEarnedAt: Date | null;
};

export type SetFact = {
  gameId: number;
  setId: number;
  /** сумма defined_* сета (размер сета) */
  definedTotal: number;
  earnedPlatinum: number;
  platinumEarnedAt: Date | null;
};

/** Контракт 28.3: основной сет версии = самый большой (ничья: меньший id); платина группы = в основном сете любой версии. */
export function groupPlatinum(sets: readonly SetFact[]): { earned: boolean; earnedAt: Date | null } {
  const byGame = new Map<number, SetFact>();
  for (const s of sets) {
    const cur = byGame.get(s.gameId);
    if (!cur || s.definedTotal > cur.definedTotal || (s.definedTotal === cur.definedTotal && s.setId < cur.setId)) byGame.set(s.gameId, s);
  }
  let earned = false;
  let earnedAt: Date | null = null;
  for (const m of byGame.values()) {
    if (m.earnedPlatinum <= 0) continue;
    earned = true;
    if (m.platinumEarnedAt && (!earnedAt || m.platinumEarnedAt < earnedAt)) earnedAt = m.platinumEarnedAt;
  }
  return { earned, earnedAt };
}

/** Какие правила подходят карточке (без учёта отказов), в порядке приоритета. */
export function matchingRules(f: HintFacts, now: Date): StatusHintRule[] {
  if (f.status === 'service') return [];
  const out: StatusHintRule[] = [];
  const t = now.getTime();
  const launched = f.lastPlayedAt?.getTime() ?? null;
  const recent = launched !== null && t - launched <= RECENT_LAUNCH_DAYS * DAY;
  const changed = f.statusChangedAt?.getTime() ?? null;

  if (f.platinumEarned && f.status !== 'completed') {
    // перепрохождение: статус поставлен после платины, значит пользователь решил осознанно
    const decidedAfter = f.status !== null && changed !== null && f.platinumEarnedAt !== null && changed > f.platinumEarnedAt.getTime();
    if (!decidedAfter) out.push('platinum');
  }
  if (f.status === 'dropped' && launched !== null && recent) {
    const base = Math.max(changed ?? 0, f.droppedAt?.getTime() ?? 0);
    if (launched > base) out.push('returned');
  }
  if ((f.status === 'backlog' || f.status === null) && f.playSeconds > 0 && launched !== null && recent) {
    if (f.status === null || (changed !== null && launched > changed)) out.push('started');
  }
  if (f.status === 'playing') {
    const base = Math.max(launched ?? 0, changed ?? 0);
    if (base > 0 && base < t - STALE_PLAYING_DAYS * DAY) out.push('stale');
  }
  return STATUS_HINT_RULES.filter((r) => out.includes(r));
}

export type StatusHint = {
  gameId: number;
  rule: StatusHintRule;
  question: string;
  reason: string;
  suggested: readonly HintStatus[];
  currentStatus: Exclude<HintFacts['status'], 'service'>;
  facts: { lastPlayedAt: string | null; statusChangedAt: string | null; platinumEarnedAt: string | null; daysSinceLaunch: number | null };
};

const STATUS_RU: Record<string, string> = { playing: 'Играю', completed: 'Пройдено', dropped: 'Брошено', backlog: 'Бэклог', shelved: 'Отложено' };
const fmtDate = (d: Date) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

function reasonText(rule: StatusHintRule, f: HintFacts, days: number | null): string {
  const cur = f.status ? `статус «${STATUS_RU[f.status]}»` : 'статуса нет';
  switch (rule) {
    case 'platinum':
      return f.platinumEarnedAt ? `Платина получена ${fmtDate(f.platinumEarnedAt)}, ${cur}.` : `Платина получена, ${cur}.`;
    case 'returned':
      return `Игра в статусе «Брошено», но запускалась ${days === 0 ? 'сегодня' : `${days} дн. назад`}.`;
    case 'started':
      return `Игра запускалась ${days === 0 ? 'сегодня' : `${days} дн. назад`}, ${cur}.`;
    case 'stale':
      return f.lastPlayedAt ? `Статус «Играю», но последний запуск ${fmtDate(f.lastPlayedAt)}.` : 'Статус «Играю», запусков нет.';
  }
}

/** Подсказка карточки: первое подходящее правило, не отклонённое пользователем. null = подсказки нет. */
export function hintFor(f: HintFacts, dismissed: ReadonlySet<StatusHintRule>, now: Date): StatusHint | null {
  if (f.status === 'service') return null;
  const rule = matchingRules(f, now).find((r) => !dismissed.has(r));
  if (!rule) return null;
  const days = f.lastPlayedAt ? Math.max(0, Math.floor((now.getTime() - f.lastPlayedAt.getTime()) / DAY)) : null;
  return {
    gameId: f.gameId,
    rule,
    question: HINT_QUESTION[rule],
    reason: reasonText(rule, f, days),
    suggested: HINT_SUGGESTED[rule],
    currentStatus: f.status,
    facts: {
      lastPlayedAt: f.lastPlayedAt?.toISOString() ?? null,
      statusChangedAt: f.statusChangedAt?.toISOString() ?? null,
      platinumEarnedAt: f.platinumEarnedAt?.toISOString() ?? null,
      daysSinceLaunch: days,
    },
  };
}

/** Порядок списка: приоритет правила, затем lastPlayedAt по убыванию (null в конце), затем gameId. */
export function sortHints(hints: readonly StatusHint[]): StatusHint[] {
  const pr = (r: StatusHintRule) => STATUS_HINT_RULES.indexOf(r);
  return [...hints].sort((a, b) => {
    const d = pr(a.rule) - pr(b.rule);
    if (d) return d;
    const la = a.facts.lastPlayedAt ? Date.parse(a.facts.lastPlayedAt) : -Infinity;
    const lb = b.facts.lastPlayedAt ? Date.parse(b.facts.lastPlayedAt) : -Infinity;
    return lb - la || a.gameId - b.gameId;
  });
}
