// Фразы-причины (контракт 18.4). LLM только переформулирует готовые факты скоринга и не выбирает игры.
// Любой сбой, мусор или таймаут = шаблон. Ключ провайдера нигде не логируется и не попадает в ошибки.
import { createHash } from 'node:crypto';
import { GENRE_LABELS_RU } from '@/shared/genres';
import type { ScoredItem } from './types';

export const LLM_TIMEOUT_MS = 5000;
export const REASON_MAX_LEN = 400;
/** Потолок токенов ответа: до 9 фраз по 200 символов (Gemini maxOutputTokens, Groq max_tokens). */
export const LLM_MAX_OUTPUT_TOKENS = 2000;
export const LLM_MAX_RESPONSE_BYTES = 64 * 1024;
export const DEFAULT_MODELS = { gemini: 'gemini-2.5-flash-lite', groq: 'llama-3.1-8b-instant' } as const;

export type LlmProviderName = 'gemini' | 'groq';
export type LlmConfig = { provider: LlmProviderName; apiKey: string; model: string };
export type PhraseFact = { id: number; name: string; genres: string[]; hours: number | null; signals: string[] };

export class LlmError extends Error {
  /** detail: машинная причина для диагностики (`http_401`, `http_400:model_not_found`, `timeout`...). Только [a-z0-9_.:-], без тел ответов и ключа. */
  constructor(readonly code: 'timeout' | 'http' | 'network' | 'bad_response', readonly detail: string = code) {
    super(`llm_${code}`); // без тел ответов и ключа
    this.name = 'LlmError';
  }
}

/** Провайдер: принимает system+user и возвращает сырой текст ответа модели. */
export interface PhraseProvider {
  readonly name: LlmProviderName;
  complete(prompt: { system: string; user: string }, signal: AbortSignal): Promise<string>;
}

type FetchLike = typeof fetch;

const cleanToken = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);
  return t || null;
};

/** `http_<статус>` и, если в теле есть error.code / error.type, `:<значение>`. Тело целиком не сохраняется. */
async function httpDetail(res: Response): Promise<string> {
  const base = `http_${Number.isInteger(res.status) ? res.status : 0}`;
  try {
    const text = (await res.text()).slice(0, 4096);
    const err = obj(obj(JSON.parse(text))?.error);
    const extra = cleanToken(err?.code) ?? cleanToken(err?.type);
    return extra ? `${base}:${extra}` : base;
  } catch {
    return base;
  }
}

async function postJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal, cache: 'no-store' });
  } catch (e) {
    throw new LlmError(signal.aborted || (e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network');
  }
  if (!res.ok) {
    throw new LlmError('http', await httpDetail(res));
  }
  try {
    const text = await res.text();
    if (text.length > LLM_MAX_RESPONSE_BYTES) throw new Error('big');
    return JSON.parse(text);
  } catch (e) {
    throw new LlmError(signal.aborted ? 'timeout' : (e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'bad_response');
  }
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function geminiProvider(cfg: LlmConfig, fetchImpl: FetchLike = fetch): PhraseProvider {
  return {
    name: 'gemini',
    async complete({ system, user }, signal) {
      // Ключ в заголовке, а не в URL: URL попадает в логи.
      const json = await postJson(
        fetchImpl,
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
        { 'x-goog-api-key': cfg.apiKey },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: LLM_MAX_OUTPUT_TOKENS },
        },
        signal,
      );
      const cand = obj(Array.isArray(obj(json)?.candidates) ? (obj(json)!.candidates as unknown[])[0] : null);
      const parts = obj(cand?.content)?.parts;
      const text = Array.isArray(parts) ? obj(parts[0])?.text : null;
      if (typeof text !== 'string') throw new LlmError('bad_response');
      return text;
    },
  };
}

export function groqProvider(cfg: LlmConfig, fetchImpl: FetchLike = fetch): PhraseProvider {
  return {
    name: 'groq',
    async complete({ system, user }, signal) {
      const json = await postJson(
        fetchImpl,
        'https://api.groq.com/openai/v1/chat/completions',
        { authorization: `Bearer ${cfg.apiKey}` },
        {
          model: cfg.model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_object' },
          temperature: 0.4,
          max_tokens: LLM_MAX_OUTPUT_TOKENS,
        },
        signal,
      );
      const choice = obj(Array.isArray(obj(json)?.choices) ? (obj(json)!.choices as unknown[])[0] : null);
      const text = obj(choice?.message)?.content;
      if (typeof text !== 'string') throw new LlmError('bad_response');
      return text;
    },
  };
}

export function createProvider(cfg: LlmConfig, fetchImpl: FetchLike = fetch): PhraseProvider {
  return cfg.provider === 'gemini' ? geminiProvider(cfg, fetchImpl) : groqProvider(cfg, fetchImpl);
}

// --- промпт

export const SYSTEM_PROMPT =
  'Ты помощник трекера игр PlayStation. Для каждой игры из списка напиши ОДНУ короткую фразу по-русски (до 200 символов): почему её стоит пройти сейчас. ' +
  'Используй ТОЛЬКО переданные факты, ничего не выдумывай. Не называй другие игры, не используй ссылки и эмодзи. Игры не выбирай и не меняй. ' +
  'Ответ строго JSON без пояснений: {"reasons":[{"id":<число из списка>,"text":"<фраза>"}]}, ровно по одному элементу на каждый id.';

/** В LLM уходят только название, жанры, часы и подписи сигналов. */
export function factsOf(items: readonly ScoredItem[]): PhraseFact[] {
  return items.map((i) => ({
    id: i.game.id,
    name: i.game.name,
    genres: i.game.genres.map((g) => GENRE_LABELS_RU[g]),
    hours: i.game.hours === null ? null : Math.round(i.game.hours * 10) / 10,
    signals: i.signals.map((s) => s.label),
  }));
}

export function buildPrompt(facts: readonly PhraseFact[]): { system: string; user: string } {
  return { system: SYSTEM_PROMPT, user: JSON.stringify({ games: facts }) };
}

// --- валидация

// Любой токен «слово.tld» (латиница, tld от 2 букв, без пробела вокруг точки), в т.ч. bit.ly/x, goo.gl/x, evil.co.
// Обычный текст не задевает: «Конец.» / «Конец. Новое» (после точки пробел или конец), числа «1.5», «v1.2», «Ep.2».
export const LINK_RE = /https?:|www\.|\b[a-z0-9][a-z0-9-]*\.[a-z]{2,}\b|\]\(|<\/?[a-z]/i;

export function isValidPhrase(text: unknown): text is string {
  return typeof text === 'string' && text.trim().length >= 1 && text.trim().length <= REASON_MAX_LEN && !LINK_RE.test(text);
}

/**
 * Разбор ответа модели: id -> фраза только для валидных. Нарушение (чужой или повторный id, не строка, длина, ссылка,
 * название другой игры из пачки) отбрасывает фразу этой игры. Полностью негодный ответ = LlmError('bad_response').
 */
export function parsePhrases(raw: string, facts: readonly PhraseFact[]): Map<number, string> {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    throw new LlmError('bad_response');
  }
  const list = Array.isArray(data) ? data : obj(data)?.reasons;
  if (!Array.isArray(list)) throw new LlmError('bad_response');
  const known = new Map(facts.map((f) => [f.id, f]));
  const seen = new Map<number, number>();
  const texts = new Map<number, string>();
  for (const el of list) {
    const o = obj(el);
    const id = o?.id;
    if (typeof id !== 'number' || !known.has(id)) continue;
    seen.set(id, (seen.get(id) ?? 0) + 1);
    if (isValidPhrase(o?.text)) texts.set(id, (o!.text as string).trim());
  }
  const out = new Map<number, string>();
  for (const [id, text] of texts) {
    if (seen.get(id) !== 1) continue;
    const mentionsOther = facts.some((f) => f.id !== id && f.name.trim().length >= 3 && text.toLowerCase().includes(f.name.trim().toLowerCase()));
    if (!mentionsOther) out.set(id, text);
  }
  return out;
}

/** Один запрос к провайдеру за пачку. Таймаут 5 с. Бросает LlmError. */
export async function requestPhrases(provider: PhraseProvider, facts: readonly PhraseFact[], timeoutMs: number = LLM_TIMEOUT_MS): Promise<Map<number, string>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const raw = await provider.complete(buildPrompt(facts), ctrl.signal);
    const out = parsePhrases(raw, facts);
    if (out.size === 0) throw new LlmError('bad_response');
    return out;
  } catch (e) {
    if (e instanceof LlmError) throw e;
    throw new LlmError(ctrl.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}

// --- кэш и шаблон

/** Хэш округлённых сигналов: фраза живёт, пока вклад не сдвинулся заметно (шаг 0.5) и часы в целых. */
export function signalsHash(item: ScoredItem): string {
  const parts = {
    id: item.game.id,
    name: item.game.name,
    genres: item.game.genres,
    hours: item.game.hours === null ? null : Math.round(item.game.hours),
    signals: item.signals.map((s) => [s.key, Math.round(s.contribution * 2) / 2]),
  };
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

const hoursGen = (h: number): string => {
  const n = Math.max(1, Math.round(h));
  return `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'часа' : 'часов'}`;
};

/** Шаблонная причина из фактов скоринга. Не зависит от LLM. */
export function templateReason(item: ScoredItem): string {
  const has = (key: string, min: number) => item.signals.some((s) => s.key === key && s.contribution >= min);
  const parts: string[] = [];
  if (item.topGenre && has('genre_affinity', 0.5)) parts.push(`жанр «${GENRE_LABELS_RU[item.topGenre]}» тебе заходит`);
  if (has('platinum_close', 0.5)) parts.push('платина уже близко');
  if (has('waiting', 0.5)) parts.push('давно ждёт в бэклоге');
  if (item.game.hours !== null && item.game.hours > 0) parts.push(`на прохождение уйдёт около ${hoursGen(item.game.hours)}`);
  if (!parts.length) return 'Лежит в бэклоге и ждёт своей очереди.';
  const s = parts.join(', ');
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}
