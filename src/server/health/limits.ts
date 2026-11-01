// Потолки RAWG/HLTB/LLM для страницы «Здоровье» (контракт F35.1). Чистая логика: env приходит аргументом, секреты не читаются в ответ.
import { getLlmEnv, getProviderLimits, LLM_DEFAULT_DAILY_LIMIT, LLM_DEFAULT_USER_DAILY_LIMIT, LLM_MAX_DAILY_LIMIT, PROVIDER_LIMIT_DEFAULTS } from '@/server/env';

type Env = Record<string, string | undefined>;

export type LimitSource = 'default' | 'env' | 'clamped';
export type DisabledReason = 'no_key' | 'no_provider' | 'limit_zero';

export type ProviderLimitView = {
  state: 'active' | 'disabled';
  reason?: DisabledReason;
  /** Эффективные значения (после приведения к диапазону). Нули в потолке на профиль невозможны: нижняя граница 1. */
  userLimit: number;
  totalLimit: number;
  userSource: LimitSource;
  totalSource: LimitSource;
};
export type RawgLimitView = ProviderLimitView & { keyConfigured: boolean };
export type LlmLimitView = ProviderLimitView & { provider: 'gemini' | 'groq' | null };

/** default: не задано или не число; env: принято как есть; clamped: вне диапазона, приведено к границе. */
export function limitSource(raw: string | undefined, min: number, max: number): LimitSource {
  if (raw === undefined || raw.trim() === '') return 'default';
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'default';
  const t = Math.trunc(n);
  return t < min || t > max ? 'clamped' : 'env';
}

export function describeRawg(env: Env): RawgLimitView {
  const { userLimit, totalLimit } = getProviderLimits('rawg', env);
  const d = PROVIDER_LIMIT_DEFAULTS.rawg;
  const keyConfigured = !!env.RAWG_API_KEY?.trim();
  const reason: DisabledReason | undefined = !keyConfigured ? 'no_key' : totalLimit === 0 ? 'limit_zero' : undefined;
  return {
    state: reason ? 'disabled' : 'active',
    ...(reason ? { reason } : {}),
    userLimit,
    totalLimit,
    userSource: limitSource(env.RAWG_USER_DAILY_LIMIT, 1, d.userMax),
    totalSource: limitSource(env.RAWG_DAILY_LIMIT, 0, d.totalMax),
    keyConfigured,
  };
}

export function describeHltb(env: Env): ProviderLimitView {
  const { userLimit, totalLimit } = getProviderLimits('hltb', env);
  const d = PROVIDER_LIMIT_DEFAULTS.hltb;
  return {
    state: totalLimit === 0 ? 'disabled' : 'active',
    ...(totalLimit === 0 ? { reason: 'limit_zero' as const } : {}),
    userLimit,
    totalLimit,
    userSource: limitSource(env.HLTB_USER_DAILY_LIMIT, 1, d.userMax),
    totalSource: limitSource(env.HLTB_DAILY_LIMIT, 0, d.totalMax),
  };
}

export function describeLlm(env: Env): LlmLimitView {
  const p = env.LLM_PROVIDER?.trim().toLowerCase();
  const provider = p === 'gemini' || p === 'groq' ? p : null;
  const llm = getLlmEnv(env);
  const totalLimit = llm?.dailyLimit ?? limitValue(env.LLM_DAILY_LIMIT, LLM_DEFAULT_DAILY_LIMIT, 0, LLM_MAX_DAILY_LIMIT);
  const userLimit = llm?.userDailyLimit ?? limitValue(env.LLM_USER_DAILY_LIMIT, LLM_DEFAULT_USER_DAILY_LIMIT, 1, LLM_MAX_DAILY_LIMIT);
  const reason: DisabledReason | undefined = !provider ? 'no_provider' : !env.LLM_API_KEY?.trim() ? 'no_key' : totalLimit === 0 ? 'limit_zero' : undefined;
  return {
    state: reason ? 'disabled' : 'active',
    ...(reason ? { reason } : {}),
    userLimit,
    totalLimit,
    userSource: limitSource(env.LLM_USER_DAILY_LIMIT, 1, LLM_MAX_DAILY_LIMIT),
    totalSource: limitSource(env.LLM_DAILY_LIMIT, 0, LLM_MAX_DAILY_LIMIT),
    provider,
  };
}

function limitValue(raw: string | undefined, def: number, min: number, max: number): number {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), min), max) : def;
}

export type UsageCell = { used: number; limit: number | null };

/** Выключенный провайдер показывает limit = null (не «безлимит»), включённый: потолок на профиль. */
export function usageCell(view: ProviderLimitView, used: number, scope: 'user' | 'total'): UsageCell {
  if (view.state === 'disabled') return { used, limit: null };
  return { used, limit: scope === 'user' ? view.userLimit : view.totalLimit };
}
