// F2-B (пакет 3): снимок индекса гайдов в БД, недельное обновление и точное сопоставление с игрой.
import { and, desc, eq, inArray, max } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { lookupKeys } from './aliases';
import { checkIndexResponse, POWERPYX_INDEX_URL, type GuideEntry } from './powerpyx';

const { guideIndex, guideIndexRuns } = schema;
const SOURCE = 'powerpyx';
/** Снимок обновляем раз в 7 дней. */
export const INDEX_MAX_AGE_MS = 7 * 86_400_000;
/** Попытка (в т. ч. неудачная) — не чаще раза в 20 ч: ночной обход, без ретраев в цикле. */
export const ATTEMPT_MIN_GAP_MS = 20 * 3600_000;
const FETCH_TIMEOUT_MS = 10_000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

export type RefreshOutcome = 'skipped_fresh' | 'skipped_recent_attempt' | 'ok' | 'challenge' | 'too_few' | 'http_error' | 'network_error';

/** Заменяет снимок источника целиком (в транзакции): старые строки удаляются только вместе со вставкой новых. */
export async function replaceSnapshot(db: AnyDb, entries: readonly GuideEntry[], now = new Date()): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.delete(guideIndex).where(eq(guideIndex.source, SOURCE));
    for (let i = 0; i < entries.length; i += 200) {
      await tx.insert(guideIndex).values(entries.slice(i, i + 200).map((e) => ({ source: SOURCE, title: e.title, titleKey: e.titleKey, url: e.url, kind: e.kind, fetchedAt: now })))
        .onConflictDoNothing();
    }
    return entries.length;
  });
}

async function needsRefresh(db: AnyDb, now: Date): Promise<'skipped_fresh' | 'skipped_recent_attempt' | null> {
  const [[snap], [run]] = await Promise.all([
    db.select({ at: max(guideIndex.fetchedAt) }).from(guideIndex).where(eq(guideIndex.source, SOURCE)),
    db.select({ at: guideIndexRuns.startedAt }).from(guideIndexRuns).where(eq(guideIndexRuns.source, SOURCE)).orderBy(desc(guideIndexRuns.startedAt)).limit(1),
  ]);
  if (snap?.at && now.getTime() - snap.at.getTime() < INDEX_MAX_AGE_MS) return 'skipped_fresh';
  if (run && now.getTime() - run.at.getTime() < ATTEMPT_MIN_GAP_MS) return 'skipped_recent_attempt';
  return null;
}

/**
 * Шаг ночной цепочки: если снимку 7+ дней и сегодня ещё не пробовали — один запрос /guides/.
 * Челлендж / мало строк / ошибка — снимок не трогаем, попытку записываем. Исключения наружу не бросает.
 */
export async function refreshGuideIndex(db: AnyDb, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<RefreshOutcome> {
  const skip = await needsRefresh(db, now);
  if (skip) return skip;
  let outcome: Exclude<RefreshOutcome, 'skipped_fresh' | 'skipped_recent_attempt'>;
  let rows = 0;
  let entries: GuideEntry[] | null = null;
  try {
    const res = await fetchImpl(POWERPYX_INDEX_URL, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) outcome = res.headers.has('cf-mitigated') ? 'challenge' : 'http_error';
    else {
      const check = checkIndexResponse(res.headers, await res.text());
      if (check.ok) { outcome = 'ok'; entries = check.entries; } else outcome = check.outcome;
    }
  } catch {
    outcome = 'network_error';
  }
  if (entries) rows = await replaceSnapshot(db, entries, now);
  await db.insert(guideIndexRuns).values({ source: SOURCE, startedAt: now, outcome, rows });
  return outcome;
}

export type GuideMatch = { title: string; url: string; wikiUrl: string | null };

/** Точное сопоставление по ключу названия (и алиасу). Несколько записей одного ключа (PS4 & PS5) — первая по названию. */
export async function findGuide(db: AnyDb, title: string): Promise<GuideMatch | null> {
  const keys = lookupKeys(title);
  if (keys.length === 0) return null;
  const rows = await db
    .select({ id: guideIndex.id, title: guideIndex.title, titleKey: guideIndex.titleKey, url: guideIndex.url, kind: guideIndex.kind })
    .from(guideIndex)
    .where(and(eq(guideIndex.source, SOURCE), inArray(guideIndex.titleKey, keys)));
  return pickGuide(rows, keys);
}

type IndexRow = { id: number; title: string; titleKey: string; url: string; kind: string };
/** Сам ключ важнее алиаса; внутри ключа — по названию, затем по id. Вики — того же названия, что и гайд. */
export function pickGuide(rows: readonly IndexRow[], keys: readonly string[]): GuideMatch | null {
  const trophy = rows
    .filter((r) => r.kind === 'trophy')
    .sort((a, b) => keys.indexOf(a.titleKey) - keys.indexOf(b.titleKey) || a.title.localeCompare(b.title) || a.id - b.id)[0];
  if (!trophy) return null;
  const wiki = rows.filter((r) => r.kind === 'wiki' && r.title === trophy.title).sort((a, b) => a.id - b.id)[0];
  return { title: trophy.title, url: trophy.url, wikiUrl: wiki?.url ?? null };
}
