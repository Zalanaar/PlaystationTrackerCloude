// Состояние онбординга для серверного guard страниц (повторный аудит P2-11): прямо из слоя БД, без HTTP к себе (/api/me/psn).
// Проверка сессии та же, что у API (requireUser: подпись, отзыв, статус входа и профиля в БД). Любая ошибка = null (fail-open).
import { getDb } from '@/db';
import { requireUser } from './require-user';
import { getPsnState } from './psn-access';

import type { SessionRole } from './session';

export interface OnboardingState { role: SessionRole; onlineId: string | null; onboardedAt: string | null }

export async function loadOnboardingState(cookieHeader: string | null): Promise<OnboardingState | null> {
  if (!cookieHeader) return null;
  try {
    const a = await requireUser(new Request('http://ssr.invalid/', { headers: { cookie: cookieHeader } }));
    if (!a.ok) return null;
    const s = await getPsnState(getDb(), a.user.id);
    if (!s) return null;
    return { role: a.user.role, onlineId: s.onlineId, onboardedAt: s.onboardedAt };
  } catch {
    return null;
  }
}
