// Шаг синка «LLM» (контракт 20.5): фразы для бэклога пачками (генерация «Нового от ИИ» убрана 2026-10-31).
// Идёт после tint и hltb в конце успешного звена, не фаза курсора. Любая ошибка = предупреждение, итог запуска не меняется.
// Экран LLM не вызывает (20.4): всё, что видит пользователь, создаётся здесь или ручной кнопкой «Обновить».
import { getLlmEnv, type LlmEnv } from '@/server/env';
import { isPaused, recordFailure, releaseCall, reserveCall, resetStreak } from '@/server/recommend/budget';
import { getDislikedIds, loadCandidates, loadHistory, readCachedReasons, writeCachedReasons } from '@/server/recommend/db';
import { createProvider, DEFAULT_MODELS, factsOf, LlmError, PHRASES_SYNC_TIMEOUT_MS, requestPhrases, type PhraseProvider } from '@/server/recommend/phrase';
import { scoreBacklog } from '@/server/recommend/score';
import type { RunContext } from './context';


/** Игр в одной пачке фраз (≈64 игры = 4 вызова). */
export const PHRASE_BATCH = 16;
/** Не начинать вызов LLM, если до конца бюджета звена осталось меньше. */
export const LLM_MIN_LEFT_MS = 8000;
const SAFETY_MS = 3000;

export type LlmStepDeps = {
  /** undefined = из env. null = LLM выключен. */
  env?: LlmEnv | null;
  provider?: PhraseProvider;
  phraseTimeoutMs?: number;
};

export const defaultLlmDeps: LlmStepDeps = {};

export type LlmStepResult = { phrasesGenerated: number; phrasesFailed: number };

const reasonOf = (e: unknown): string => (e instanceof LlmError ? e.detail : 'network');

export async function llmStep(ctx: RunContext, deps: LlmStepDeps): Promise<LlmStepResult> {
  const res: LlmStepResult = { phrasesGenerated: 0, phrasesFailed: 0 };
  const env = deps.env === undefined ? getLlmEnv() : deps.env;
  if (!env) return res;
  const db = ctx.db;
  const now = ctx.now();
  await resetStreak(db, now); // пауза действует «до следующего синка» (20.4)

  // 1. Фразы всего бэклога пачками, только для изменившихся фактов
  const [candidates, history, dislikedIds] = await Promise.all([loadCandidates(db, ctx.userId), loadHistory(db, ctx.userId), getDislikedIds(db, ctx.userId, now)]);
  const scored = scoreBacklog({ candidates, history, dislikedIds, time: 'any', now, limit: Number.MAX_SAFE_INTEGER });
  const cached = await readCachedReasons(db, ctx.userId, scored.items);
  const missing = scored.items.filter((i) => !cached.has(i.game.id));
  const provider = deps.provider ?? createProvider({ provider: env.provider, apiKey: env.apiKey, model: env.model ?? DEFAULT_MODELS[env.provider] });
  let lastReason = '';
  for (let at = 0; at < missing.length; at += PHRASE_BATCH) {
    if (ctx.timeLeft() < LLM_MIN_LEFT_MS) break;
    if (await isPaused(db)) break;
    if (!(await reserveCall(db, ctx.userId, 'phrases', env.dailyLimit, now, env.userDailyLimit))) break;
    const batch = missing.slice(at, at + PHRASE_BATCH);
    let fresh: Map<number, string>;
    try {
      const timeout = Math.min(deps.phraseTimeoutMs ?? PHRASES_SYNC_TIMEOUT_MS, Math.max(1000, ctx.timeLeft() - SAFETY_MS));
      fresh = await requestPhrases(provider, factsOf(batch), timeout);
    } catch (e) {
      lastReason = reasonOf(e);
      res.phrasesFailed++;
      await releaseCall(db, ctx.userId, 'phrases', now);
      await recordFailure(db, lastReason, now);
      continue;
    }
    // провайдер ответил: вызов потрачен; ошибка записи в БД не вина провайдера (не возвращаем вызов, не копим неудачи)
    await resetStreak(db, now);
    try {
      await writeCachedReasons(db, ctx.userId, batch, fresh, now);
      res.phrasesGenerated += fresh.size;
    } catch {
      res.phrasesFailed++;
      lastReason = 'db_error';
      break;
    }
  }
  if (res.phrasesFailed > 0) ctx.warn('llm_phrases_failed', `LLM: фразы бэклога, ошибок ${res.phrasesFailed} (${lastReason}), игры повторятся в следующем синке.`);

  return res;
}
