// Массовая подгрузка длительности с HLTB (контракт 16.7): цикл POST /api/hltb/run на клиенте, чистая функция с подменяемым вызовом.

export type HltbRunWarning = { code: string; message: string };
export type HltbStopReason = 'complete' | 'budget' | 'errors' | 'empty' | 'no_time' | 'limit';
export type HltbRunResponse = {
  processed: number; found: number; notFound: number; failed: number; remaining: number; done: boolean; stopReason: HltbStopReason; warnings: HltbRunWarning[];
};
export type HltbRunBody = { recheckNotFound?: boolean; since?: string };

/** Защитный лимит вызовов за один запуск цикла: 40 вызовов по ~45 с покрывают сотни игр, дальше повтор вручную. */
export const HLTB_MAX_ITERATIONS = 40;

export type HltbRunTotals = { processed: number; found: number; notFound: number; failed: number; remaining: number | null; calls: number };
export type HltbLoopEnd =
  | { kind: 'complete' }
  | { kind: 'stopped' }
  | { kind: 'limit' }
  | { kind: 'halted'; reason: HltbStopReason }
  | { kind: 'error'; status: number; code: string; reason?: string };
export type HltbLoopResult = { end: HltbLoopEnd; totals: HltbRunTotals; warnings: HltbRunWarning[] };

/** Ошибка вызова с кодом HTTP; бросается вызывающей стороной (fetchHltbRun) и разбирается циклом. */
export class HltbCallError extends Error {
  constructor(public status: number, public code: string, public reason?: string) {
    super(code);
  }
}

/** Запас на разброс часов устройства и сервера: сервер отвергает since из будущего больше чем на 5 секунд. */
export const HLTB_SINCE_MARGIN_MS = 60_000;

/** Граница перепроверки: «сейчас» устройства минус запас. Вызывается один раз в начале цикла. */
export function hltbSince(nowMs: number): string {
  return new Date(nowMs - HLTB_SINCE_MARGIN_MS).toISOString();
}

export type HltbLoopOptions = {
  run: (body: HltbRunBody, signal?: AbortSignal) => Promise<HltbRunResponse>;
  /** Прерывает запрос в полёте; отмена считается остановкой пользователем, а не сбоем. */
  signal?: AbortSignal;
  recheckNotFound: boolean;
  /** Момент начала цикла (ISO): фиксируется один раз и уходит во все вызовы. */
  since: string;
  shouldStop: () => boolean;
  onProgress?: (t: HltbRunTotals) => void;
  maxIterations?: number;
};

export async function runHltbLoop(o: HltbLoopOptions): Promise<HltbLoopResult> {
  const max = o.maxIterations ?? HLTB_MAX_ITERATIONS;
  const body: HltbRunBody = o.recheckNotFound ? { recheckNotFound: true, since: o.since } : {};
  const totals: HltbRunTotals = { processed: 0, found: 0, notFound: 0, failed: 0, remaining: null, calls: 0 };
  const warnings: HltbRunWarning[] = [];
  const result = (end: HltbLoopEnd): HltbLoopResult => ({ end, totals, warnings });
  while (totals.calls < max) {
    if (o.shouldStop()) return result({ kind: 'stopped' });
    let r: HltbRunResponse;
    try {
      r = await o.run(body, o.signal);
    } catch (e) {
      if (o.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) return result({ kind: 'stopped' });
      if (e instanceof HltbCallError) return result({ kind: 'error', status: e.status, code: e.code, reason: e.reason });
      return result({ kind: 'error', status: 0, code: 'network' });
    }
    totals.calls++;
    totals.processed += r.processed;
    totals.found += r.found;
    totals.notFound += r.notFound;
    totals.failed += r.failed;
    totals.remaining = r.remaining;
    for (const w of r.warnings ?? []) if (!warnings.some((x) => x.code === w.code && x.message === w.message)) warnings.push(w);
    o.onProgress?.({ ...totals });
    if (r.done) return result(r.remaining > 0 && r.stopReason !== 'complete' ? { kind: 'halted', reason: r.stopReason !== 'limit' && warnings.some((x) => x.code === 'hltb_limit') ? 'limit' : r.stopReason } : { kind: 'complete' });
  }
  return result({ kind: 'limit' });
}

const STOP_TEXT: Record<HltbStopReason, string> = {
  complete: 'все игры проверены',
  budget: 'вышло время запроса',
  errors: 'HLTB несколько раз подряд вернул ошибку',
  empty: 'HLTB вернул пустой ответ на все запросы',
  no_time: 'не хватило времени на запрос',
  limit: 'Достигнут дневной лимит HLTB',
};

/** Итоговая строка: что нашли, что нет, сколько ошибок. */
export function hltbSummaryText(t: HltbRunTotals): string {
  return `Проверено ${t.processed}: найдено ${t.found}, не найдено ${t.notFound}, ошибок ${t.failed}.`;
}

export function hltbProgressText(t: HltbRunTotals): string {
  return t.remaining === null ? 'Проверяем…' : `Проверено ${t.processed}, осталось ${t.remaining}`;
}

/** Сообщение о конце цикла и его тон. */
export function hltbEndMessage(r: HltbLoopResult): { tone: 'ok' | 'warn' | 'error'; text: string } {
  const sum = hltbSummaryText(r.totals);
  switch (r.end.kind) {
    case 'complete':
      return { tone: r.totals.failed > 0 ? 'warn' : 'ok', text: `Готово. ${sum}` };
    case 'stopped':
      return { tone: 'warn', text: `Остановлено. ${sum} Повторный запуск продолжит с того же места.` };
    case 'limit':
      return { tone: 'warn', text: `Достигнут лимит запросов за один запуск. ${sum} Запустите ещё раз, чтобы продолжить.` };
    case 'halted':
      return { tone: 'warn', text: `${r.end.reason === 'limit' ? STOP_TEXT.limit : `Остановлено: ${STOP_TEXT[r.end.reason]}`}. ${sum} Осталось ${r.totals.remaining ?? 0}, повторите позже.` };
    case 'error':
      if (r.end.status === 409) return { tone: 'warn', text: `Подгрузка длительности уже идёт, повторите позже. ${r.totals.processed > 0 ? sum : ''}`.trim() };
      if (r.end.status === 503) return { tone: 'error', text: `База данных недоступна, повторите позже. ${r.totals.processed > 0 ? sum : ''}`.trim() };
      if (r.end.status === 400 && r.end.reason === 'since_in_future') return { tone: 'error', text: 'Часы устройства не совпадают с сервером, перепроверка не запущена.' };
      if (r.end.status === 400) return { tone: 'error', text: 'Сервер отклонил запрос.' };
      return { tone: 'error', text: `Нет связи с сервером. ${r.totals.processed > 0 ? sum : ''}`.trim() };
  }
}
