// «Забытые игры» (контракт 14.4). Чистые функции; SQL-условие строится в query.ts по forgottenCutoff.
export const FORGOTTEN_DAYS = 90;

/** Момент, раньше которого последний запуск делает игру забытой: now - 90 суток. */
export function forgottenCutoff(now: Date): Date {
  return new Date(now.getTime() - FORGOTTEN_DAYS * 86_400_000);
}

export type ForgottenInput = {
  status: string | null;
  playSeconds: number;
  /** ISO UTC или Date */
  lastPlayedAt: string | Date | null;
  hiddenAt?: string | Date | null;
};

/** Видимая, без статуса, playtime > 0, last_played_at < now - 90 суток. Без даты запуска не забытая. */
export function isForgotten(g: ForgottenInput, now: Date): boolean {
  if (g.status !== null || g.playSeconds <= 0 || g.lastPlayedAt === null) return false;
  if (g.hiddenAt !== undefined && g.hiddenAt !== null) return false;
  const at = typeof g.lastPlayedAt === 'string' ? new Date(g.lastPlayedAt) : g.lastPlayedAt;
  return at.getTime() < forgottenCutoff(now).getTime();
}
