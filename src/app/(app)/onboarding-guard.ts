import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readSessionToken, SESSION_COOKIE } from '@/server/auth/session';
import { getSessionSecret } from '@/server/env';
import { needsOnboarding } from '@/ui/onboarding/model';

/**
 * Активный не-владелец без ника PSN или без завершённой первой загрузки уходит на /onboarding (design-system §9.1).
 * Данные берутся из GET /api/me/psn (прямой доступ к БД из страниц запрещён). Владелец не проверяется (роль из подписанной сессии).
 * Любая ошибка (сеть, БД, 401) редирект не вызывает: сайт не должен падать из-за этой проверки.
 */
export async function redirectToOnboardingIfNeeded(): Promise<void> {
  let go = false;
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    const session = await readSessionToken(token, getSessionSecret());
    if (!session || session.role === 'owner') return;
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (!host) return;
    const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
    const res = await fetch(`${proto}://${host}/api/me/psn`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { ok?: boolean; data?: { onlineId: string | null; onboardedAt: string | null } };
    if (!json.ok || !json.data) return;
    go = needsOnboarding({ role: session.role, status: 'active', onlineId: json.data.onlineId, onboardedAt: json.data.onboardedAt });
  } catch {
    return;
  }
  if (go) redirect('/onboarding');
}
