// Проверка доступа технического аккаунта к профилю пользователя (контракт 22.13). Единственное место, где это делается.
// Профиль -> accountId, затем одна страница игр и одна страница трофейных сетов. Токены и NPSSO не логируются.
import * as psnLib from 'psn-api';
import { PsnError, classifyPsnError } from './errors';

export type AccessApi = Pick<typeof psnLib, 'getProfileFromUserName' | 'getUserPlayedGames' | 'getUserTitles'>;

export type AccessCheck =
  | { status: 'ok'; accountId: string }
  | { status: 'not_found' }
  | { status: 'private' }
  /** PSN не ответил по делу (лимит, сбой, токен технического аккаунта не принят): повторить позже. */
  | { status: 'unavailable'; reason: PsnError['reason'] };

export type AccessDeps = {
  getAccessToken: (force: boolean) => Promise<string>;
  api?: AccessApi;
  secrets?: ReadonlyArray<string | null | undefined>;
};

/** Ник PSN: 3..16 символов, латиница/цифры/дефис/подчёркивание, начинается с буквы. */
export const PSN_ONLINE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{2,15}$/;

const NOT_FOUND_RE = /user not found|resource not found|\b404\b|not found/i;

/** Профиль не найден отличаем от закрытого по тексту (psn-api статус не отдаёт). Остальные отказы = закрыто. */
function denialKind(e: PsnError): 'not_found' | 'private' {
  return NOT_FOUND_RE.test(e.message) ? 'not_found' : 'private';
}

export async function checkProfileAccess(deps: AccessDeps, onlineId: string): Promise<AccessCheck> {
  const api = deps.api ?? psnLib;
  const secrets = deps.secrets ?? [];
  let token: string;
  let refreshed = false;
  try {
    token = await deps.getAccessToken(false);
  } catch (e) {
    return { status: 'unavailable', reason: classifyPsnError(e, secrets).reason };
  }

  /** Вызов с одним обновлением токена при 401. Бросает PsnError. */
  async function call<T>(fn: (auth: { accessToken: string }) => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await fn({ accessToken: token });
      } catch (e) {
        const err = classifyPsnError(e, [...secrets, token]);
        if (err.reason === 'auth_expired' && !refreshed) {
          refreshed = true;
          token = await deps.getAccessToken(true);
          continue;
        }
        throw err;
      }
    }
  }

  let stage: 'profile' | 'data' = 'profile';
  try {
    const profile = await call((auth) => api.getProfileFromUserName(auth, onlineId));
    const accountId = profile?.profile?.accountId;
    if (typeof accountId !== 'string' || !accountId) return { status: 'not_found' };
    stage = 'data';
    await call((auth) => api.getUserPlayedGames(auth, accountId, { limit: 1, offset: 0 }));
    await call((auth) => api.getUserTitles(auth, accountId, { limit: 1, offset: 0 }));
    return { status: 'ok', accountId };
  } catch (e) {
    const err = classifyPsnError(e, secrets);
    // «не найден» осмыслен только для поиска профиля; отказ на данных профиля = закрыто
    if (err.reason === 'access_denied') return { status: stage === 'profile' ? denialKind(err) : 'private' };
    return { status: 'unavailable', reason: err.reason };
  }
}
