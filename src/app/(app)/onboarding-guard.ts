import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readSessionToken, SESSION_COOKIE } from '@/server/auth/session';
import { getSessionSecret } from '@/server/env';
import { loadOnboardingState } from '@/server/auth/onboarding-state';
import { needsOnboarding } from '@/ui/onboarding/model';

/**
 * Активный не-владелец без ника PSN или без завершённой первой загрузки уходит на /onboarding (design-system §9.1).
 * Владелец не проверяется (роль из подписанной сессии, без БД). Для остальных состояние берёт серверный сервис
 * `loadOnboardingState` (requireUser + getPsnState, как SSR-загрузчик `/`), без HTTP к себе на /api/me/psn (повторный аудит P2-11).
 * Любая ошибка (БД, 401) редирект не вызывает: сайт не должен падать из-за этой проверки.
 */
export async function redirectToOnboardingIfNeeded(): Promise<void> {
  let go = false;
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    const session = await readSessionToken(token, getSessionSecret());
    if (!session || session.role === 'owner') return;
    const state = await loadOnboardingState(`${SESSION_COOKIE}=${token}`);
    if (!state) return;
    go = needsOnboarding({ role: state.role, status: 'active', onlineId: state.onlineId, onboardedAt: state.onboardedAt });
  } catch {
    return;
  }
  if (go) redirect('/onboarding');
}
