// Branded-тип идентификатора пользователя (контракт 22.6). Получить его вне server/auth и server/scope можно только из requireUser().
declare const brand: unique symbol;
export type UserId = number & { readonly [brand]: 'UserId' };

/** Только внутри src/server/auth/ и src/server/scope/. */
export function asUserId(n: number): UserId {
  if (!Number.isInteger(n) || n <= 0) throw new Error('invalid user id');
  return n as UserId;
}
