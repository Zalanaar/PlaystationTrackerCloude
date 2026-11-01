// Шаг синка «У тебя нет» (контракт Фазы 30, 30.4): раз в сутки пересчитывает подборку игр вне библиотеки из RAWG.
// Идёт после шага LLM в конце успешного звена, не фаза курсора. Любая ошибка = предупреждение, итог запуска не меняется.
import { refreshDiscover, type DiscoverDeps, type DiscoverRunResult } from '@/server/recommend/discover';
import type { RunContext } from './context';

export type DiscoverStepDeps = Omit<DiscoverDeps, 'timeLeft'>;

export const defaultDiscoverDeps: DiscoverStepDeps = {};

export async function discoverStep(ctx: RunContext, deps: DiscoverStepDeps): Promise<DiscoverRunResult> {
  const res = await refreshDiscover(ctx.db, ctx.userId, ctx.now(), { ...deps, timeLeft: () => ctx.timeLeft() });
  if (res.status === 'limit') ctx.warn('discover_limit', 'У тебя нет: лимит запросов RAWG исчерпан, подборка добавится в следующем синке.');
  if (res.failures.length > 0) {
    const reasons = [...new Set(res.failures)].join(', ');
    ctx.warn('discover_failed', `У тебя нет: ошибок RAWG ${res.failures.length} (${reasons}), недобранное повторится в следующем синке.`);
  }
  return res;
}
