// Чистые константы «Подскажи» (контракт 18.9), нужные и серверу, и UI.
/** Сколько суток действует «Не интересно» с момента created_at. */
export const DISLIKE_TTL_DAYS = 30;
export const DISLIKE_TTL_MS = DISLIKE_TTL_DAYS * 86_400_000;

/** Момент истечения отметки. */
export function dislikeExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + DISLIKE_TTL_MS);
}

/** Отметка действует, пока now строго раньше created_at + 30 суток. */
export function isDislikeActive(createdAt: Date, now: Date): boolean {
  return now.getTime() < createdAt.getTime() + DISLIKE_TTL_MS;
}
