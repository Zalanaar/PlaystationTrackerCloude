// Подсказки смены статуса (контракт 28): константы и типы без env/БД/сети, общие для сервера и UI.
export const STATUS_HINT_RULES = ['platinum', 'returned', 'started', 'stale'] as const;
export type StatusHintRule = (typeof STATUS_HINT_RULES)[number];

/** Подсказка может предложить только эти статусы (не `backlog`, не `service`). */
export type HintStatus = 'playing' | 'completed' | 'dropped' | 'shelved';

/** «Играю?» / «Вернулся?»: запуск не старше стольких суток. */
export const RECENT_LAUNCH_DAYS = 14;
/** «Играю» без запусков дольше стольких суток. */
export const STALE_PLAYING_DAYS = 30;

export const HINT_QUESTION: Record<StatusHintRule, string> = {
  platinum: 'Пройдено?',
  returned: 'Вернулся?',
  started: 'Играю?',
  stale: 'Отложить / бросить?',
};

export const HINT_SUGGESTED: Record<StatusHintRule, readonly HintStatus[]> = {
  platinum: ['completed'],
  returned: ['playing'],
  started: ['playing'],
  stale: ['shelved', 'dropped'],
};

export function isStatusHintRule(v: unknown): v is StatusHintRule {
  return typeof v === 'string' && (STATUS_HINT_RULES as readonly string[]).includes(v);
}
