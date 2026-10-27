// Чистая логика лимита неудачных входов (контракт 3.3). Данные берутся из login_attempts в attempts.ts.
export const IP_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };
export const GLOBAL_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 };

export type LimitResult = { limited: false } | { limited: true; retryAfterSeconds: number };

type Rule = { max: number; windowMs: number };

function check(failures: readonly Date[], now: Date, rule: Rule): LimitResult {
  const from = now.getTime() - rule.windowMs;
  const inWindow = failures.map((d) => d.getTime()).filter((t) => t > from && t <= now.getTime()).sort((a, b) => a - b);
  if (inWindow.length < rule.max) return { limited: false };
  // освободится слот, когда из окна выпадет попытка, после которой останется max-1
  const releasing = inWindow[inWindow.length - rule.max];
  const retryAfterSeconds = Math.max(1, Math.ceil((releasing + rule.windowMs - now.getTime()) / 1000));
  return { limited: true, retryAfterSeconds };
}

/**
 * @param ipFailures моменты неудачных попыток этого IP
 * @param allFailures моменты неудачных попыток всех (глобальный лимит)
 */
export function evaluateLimit(ipFailures: readonly Date[], allFailures: readonly Date[], now: Date = new Date()): LimitResult {
  const a = check(ipFailures, now, IP_LIMIT);
  const b = check(allFailures, now, GLOBAL_LIMIT);
  if (a.limited && b.limited) return { limited: true, retryAfterSeconds: Math.max(a.retryAfterSeconds, b.retryAfterSeconds) };
  return a.limited ? a : b;
}
