// Режим «Проверить» (design-system §13, контракт 28): очередь подсказок смены статуса. Сайт только предлагает.
import type { GameItem, GameStatusValue } from '@/server/collection/types';
import type { StatusHint } from '@/server/sync/status-hints';
import { HINT_QUESTION, HINT_SUGGESTED, type HintStatus, type StatusHintRule } from '@/shared/status-hints';
import { formatDayMonth, formatDdMm } from '../format';
import { STATUS_META, TRIAGE_SWIPE_CHECK } from '../tokens';

/** Элемент ответа GET /api/status-hints: подсказка + карточка игры (контракт 28.4). */
export type HintItem = StatusHint & { game: GameItem };
export type HintsResponse = { count: number; items: HintItem[] };

/** Снимок прошлой строки статуса (контракт 28.9 `restore`), снятый ДО «Принять». */
export type StatusRestore = { status: GameStatusValue; statusChangedAt: string; completedAt: string | null; droppedAt: string | null };

export type HintAction = { id: number } & (
  | { kind: 'accept'; hint: HintItem; status: GameStatusValue; snapshot: StatusRestore | null }
  | { kind: 'keep'; hint: HintItem }
  | { kind: 'dismiss'; hint: HintItem }
  | { kind: 'conflict'; hint: HintItem } // статус сменили в другом месте: карточка проверена, откатывать нечего
);
type Draft<T> = T extends unknown ? Omit<T, 'id'> : never;
export type HintState = { queue: HintItem[]; history: HintAction[]; total: number };

export const initHints = (items: HintItem[]): HintState => ({ queue: items, history: [], total: items.length });

let actionSeq = 0;
const take = (s: HintState, a: (head: HintItem) => Draft<HintAction>): HintState => {
  const [head, ...rest] = s.queue;
  return head ? { ...s, queue: rest, history: [...s.history, { id: ++actionSeq, ...a(head) } as HintAction] } : s;
};

/** Снимок для отката: `currentStatus`, `facts.statusChangedAt`, `game.completedAt/droppedAt` подсказки. Без прошлого статуса снимка нет. */
export function restoreSnapshot(h: HintItem): StatusRestore | null {
  const cur = h.currentStatus;
  if (!cur || !h.facts.statusChangedAt) return null;
  return { status: cur, statusChangedAt: h.facts.statusChangedAt, completedAt: cur === 'completed' ? h.game.completedAt : null, droppedAt: cur === 'dropped' ? h.game.droppedAt : null };
}

export const acceptHint = (s: HintState, status: GameStatusValue) => take(s, (hint) => ({ kind: 'accept', hint, status, snapshot: restoreSnapshot(hint) }));
export const keepHint = (s: HintState) => take(s, (hint) => ({ kind: 'keep', hint }));
export const dismissHint = (s: HintState) => take(s, (hint) => ({ kind: 'dismiss', hint }));
/** Действие, которое только что добавили в историю. */
export const lastAction = (s: HintState): HintAction | undefined => s.history[s.history.length - 1];

/** Тело PUT для отката «Принять» (контракт 28.9): прежний статус, `expectedStatus` = принятая цель, `restore` из снимка. */
export function undoAcceptBody(a: Extract<HintAction, { kind: 'accept' }>): { status: GameStatusValue | null; expectedStatus: GameStatusValue; restore?: StatusRestore } {
  return a.snapshot
    ? { status: a.snapshot.status, expectedStatus: a.status, restore: a.snapshot }
    : { status: a.hint.currentStatus, expectedStatus: a.status };
}

/** Отмена действия по id: карточка возвращается в начало очереди. Нет такого действия (уже откатано, ошибка, конфликт) = ничего. */
export function undoHintById(s: HintState, id: number): { state: HintState; undone: HintAction | null } {
  const a = s.history.find((x) => x.id === id);
  if (!a || a.kind === 'conflict') return { state: s, undone: null };
  return { state: { ...s, queue: [a.hint, ...s.queue.filter((h) => h.gameId !== a.hint.gameId)], history: s.history.filter((x) => x.id !== id) }, undone: a };
}

/** Отмена последнего откатываемого действия (клавиша Z): записи о конфликте пропускаются. */
export function undoHint(s: HintState): { state: HintState; undone: HintAction | null } {
  const last = [...s.history].reverse().find((x) => x.kind !== 'conflict');
  return last ? undoHintById(s, last.id) : { state: s, undone: null };
}

/** Откат неудачного запроса: карточка в начало, записи истории по ней нет. */
export function rollbackHint(s: HintState, gameId: number): HintState {
  const idx = s.history.map((a) => a.hint.gameId).lastIndexOf(gameId);
  if (idx < 0) return s;
  const hint = s.history[idx].hint;
  return { ...s, queue: [hint, ...s.queue.filter((h) => h.gameId !== gameId)], history: s.history.filter((_, i) => i !== idx) };
}

/** Повтор отменённого действия, если сам откат на сервере не удался. */
export function replayHint(s: HintState, a: HintAction): HintState {
  return { ...s, queue: s.queue.filter((h) => h.gameId !== a.hint.gameId), history: [...s.history, a] };
}

/** Игра удалена (404): подсказка исчезла без следа, счётчик уменьшается. */
export function dropHint(s: HintState, gameId: number): HintState {
  const idx = s.history.map((a) => a.hint.gameId).lastIndexOf(gameId);
  return { ...s, queue: s.queue.filter((h) => h.gameId !== gameId), history: idx < 0 ? s.history : s.history.filter((_, i) => i !== idx), total: Math.max(0, s.total - 1) };
}

/** 409: статус уже изменён в другом месте. Карточка уходит из очереди, счётчик не откатывается (запись `conflict` вместо действия). */
export function settleConflict(s: HintState, hint: HintItem, actionId: number): HintState {
  return {
    ...s,
    queue: s.queue.filter((h) => h.gameId !== hint.gameId),
    history: [...s.history.filter((x) => x.id !== actionId), { id: ++actionSeq, kind: 'conflict', hint }],
  };
}

export function summarizeHints(history: readonly HintAction[]): { accepted: number; kept: number; dismissed: number } {
  const n = { accepted: 0, kept: 0, dismissed: 0 };
  for (const a of history) {
    if (a.kind === 'accept') n.accepted++;
    else if (a.kind === 'keep') n.kept++;
    else if (a.kind === 'dismiss') n.dismissed++;
  }
  return n;
}

/** «3 / 12», осталось. Проверено = все действия, включая «Оставить» и «Не предлагать». */
export function hintProgress(s: HintState): { done: number; total: number; left: number; fraction: number } {
  const total = s.total;
  const done = Math.min(s.history.length, total);
  return { done, total, left: Math.max(0, total - done), fraction: total ? done / total : 1 };
}

/** Основная цель подсказки (клавиша Enter): первая из `suggested`. */
export const primaryTarget = (h: Pick<StatusHint, 'rule' | 'suggested'>): HintStatus => h.suggested[0] ?? HINT_SUGGESTED[h.rule][0];
export const isHintTarget = (h: Pick<StatusHint, 'suggested'>, s: GameStatusValue): boolean => (h.suggested as readonly string[]).includes(s);
/** Статус, который у игры уже стоит: кнопка «сейчас», нажатие ничего не делает. */
export const isCurrentStatus = (h: Pick<StatusHint, 'currentStatus'>, s: GameStatusValue): boolean => h.currentStatus === s;

/** Вопрос правила (чип и очередь). */
export const hintQuestion = (rule: StatusHintRule): string => HINT_QUESTION[rule];

/** Подпись основной кнопки: «Принять: Играю»; у stale две кнопки «Отложить» и «Бросить». */
export const acceptLabel = (s: HintStatus): string => `Принять: ${STATUS_META[s].label}`;
export const STALE_LABEL: Partial<Record<HintStatus, string>> = { shelved: 'Отложить', dropped: 'Бросить' };

/** Подпись даты у «Пройдено» для платины: дата завершения = последний запуск, дата платины в подпись не идёт. Без запуска подписи нет. */
export function platinumDateNote(h: Pick<HintItem, 'rule' | 'game'>): string | null {
  if (h.rule !== 'platinum') return null;
  const d = formatDdMm(h.game.lastPlayedAt);
  return d ? `дата завершения — последний запуск: ${d}` : null;
}

/** Дата-подсказка у ключей «Пройдено» и «Брошено» = последний запуск; у платины своя подпись. */
export function keyDateHint(h: HintItem, status: GameStatusValue): string | null {
  if (status !== 'completed' && status !== 'dropped') return null;
  if (status === 'completed' && h.rule === 'platinum') return platinumDateNote(h);
  return `дата: ${formatDayMonth(h.game.lastPlayedAt, true) ?? 'сегодня'}`;
}

export type Seg = { text: string; bold?: boolean };

const quoted = (s: GameStatusValue | null) => (s ? `«${STATUS_META[s].label}»` : '');
const day = (iso: string | null) => formatDayMonth(iso);

/** Причина по шаблонам §13.2 из фактов (не из `reason` API). Фрагмент без даты опускается целиком. */
export function hintReason(h: Pick<StatusHint, 'rule' | 'currentStatus' | 'facts'>): Seg[] {
  const { lastPlayedAt, statusChangedAt, platinumEarnedAt, daysSinceLaunch } = h.facts;
  const cur = h.currentStatus;
  const out: Seg[] = [];
  const t = (text: string) => out.push({ text });
  const b = (text: string) => out.push({ text, bold: true });
  const launch = day(lastPlayedAt);
  const since = day(statusChangedAt);
  switch (h.rule) {
    case 'started':
      if (cur === null) {
        if (launch) { t('Игра запускалась '); b(launch); t(', статуса у неё нет.'); } else t('У игры нет статуса, но она запускалась.');
      } else {
        if (launch) { t('Последний запуск '); b(launch); t(`, а статус ${quoted(cur)}`); } else t(`Статус ${quoted(cur)}`);
        if (since) { t(' стоит с '); b(since); }
        t('. Поставить «Играю»?');
      }
      break;
    case 'stale':
      t(`Статус «Играю», но запусков нет`);
      if (daysSinceLaunch !== null) { t(' уже '); b(`${daysSinceLaunch} дн.`); if (launch) t(` (последний ${launch})`); }
      t('. Отложить или бросить?');
      break;
    case 'platinum':
      if (platinumEarnedAt && day(platinumEarnedAt)) { t('Получена платина '); b(day(platinumEarnedAt) as string); } else t('Получена платина');
      t(cur ? `, а статус ${quoted(cur)}. Отметить пройденной?` : ', а статуса нет. Отметить пройденной?');
      break;
    case 'returned':
      t('Игра в «Брошено»');
      if (since) { t(' с '); b(since); }
      t(', но запускалась ');
      if (launch) b(launch); else t('недавно');
      t(since ? ', уже после этого. Вернуть в «Играю»?' : '. Вернуть в «Играю»?');
      break;
  }
  // дата «5 окт.» уже кончается точкой: не удваиваем её перед концом предложения
  return out.map((seg, i) => (i > 0 && seg.text.startsWith('.') && out[i - 1].text.endsWith('.') ? { ...seg, text: seg.text.slice(1) } : seg));
}

export const hintReasonText = (h: Pick<StatusHint, 'rule' | 'currentStatus' | 'facts'>): string => hintReason(h).map((s) => s.text).join('');

export type CheckSwipe = 'accept' | 'keep';

/** Свайп в режиме «Проверить»: только горизонталь; вверх и вниз отключены (случайный жест не меняет статус). */
export function checkSwipe(dx: number, dy: number, width: number, fraction = 0.3): CheckSwipe | null {
  if (Math.abs(dx) < width * fraction || Math.abs(dx) < Math.abs(dy)) return null;
  return dx > 0 ? TRIAGE_SWIPE_CHECK.right : TRIAGE_SWIPE_CHECK.left;
}

/** Подпись режима в сегменте и чипе Коллекции. */
export const checkSegmentText = (n: number) => `Проверить ${n}`;
export const checkChipText = (n: number) => `Проверить статусы: ${n}`;
/** Безопасное число из ответа count (нет поля, не число = 0). */
export const checkCountOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Живая область для читалки (§13.7). */
export const hintAnnounce = (pos: number, total: number, h: Pick<HintItem, 'rule' | 'game'>): string => `Подсказка ${pos} из ${total}: ${HINT_QUESTION[h.rule]} ${h.game.title}`;
