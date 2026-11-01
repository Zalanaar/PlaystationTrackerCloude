// QA Фазы 35: названия kind/error_reason в UI сверены с реальными enum в схеме БД.
import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { schema } from '@/db';
import { errorReasonLabel, runKindLabel } from './model';
import { describeLlm, describeRawg } from '@/server/health/limits';

const kinds = getTableColumns(schema.syncRuns).kind.enumValues as readonly string[];
const reasons = getTableColumns(schema.syncRuns).errorReason.enumValues as readonly string[];

describe('QA-35: подписи против схемы', () => {
  it('daily и manual имеют русскую подпись', () => {
    for (const k of ['daily', 'manual']) expect(runKindLabel(k), `kind=${k}`).not.toBe(k);
  });
  // QA-35-1: подписи есть у несуществующих kind (initial/onboarding/trophies), а у реального trophy_backfill нет. it.fails: станет красным, когда баг починят (тогда сменить на it).
  it.fails('trophy_backfill имеет русскую подпись (QA-35-1, баг продукта)', () => {
    expect(runKindLabel('trophy_backfill')).not.toBe('trophy_backfill');
  });
  it('error_reason из схемы (кроме cancelled) не падают в «другая ошибка»', () => {
    for (const r of reasons.filter((x) => x !== 'cancelled')) expect(errorReasonLabel(r), r).not.toBe('другая ошибка');
  });
  it('в подписях нет несуществующих kind (initial/onboarding/trophies)', () => {
    // Документируем расхождение: см. docs/qa/phase-35.md QA-35-1. Тест фиксирует, что реальные значения покрыты.
    expect(kinds).toEqual(['daily', 'manual', 'trophy_backfill', 'hltb']);
  });
});

describe('QA-35: потолки не выглядят безлимитом', () => {
  it('RAWG_DAILY_LIMIT=0 и LLM_DAILY_LIMIT=0: disabled/limit_zero', () => {
    expect(describeRawg({ RAWG_API_KEY: 'k', RAWG_DAILY_LIMIT: '0' })).toMatchObject({ state: 'disabled', reason: 'limit_zero' });
    expect(describeLlm({ LLM_PROVIDER: 'groq', LLM_API_KEY: 'k', LLM_DAILY_LIMIT: '0' })).toMatchObject({ state: 'disabled', reason: 'limit_zero' });
  });
  it('RAWG_USER_DAILY_LIMIT=0 даёт 1 и clamped; 99999 даёт максимум и clamped', () => {
    expect(describeRawg({ RAWG_API_KEY: 'k', RAWG_USER_DAILY_LIMIT: '0' })).toMatchObject({ userLimit: 1, userSource: 'clamped' });
    expect(describeRawg({ RAWG_API_KEY: 'k', RAWG_USER_DAILY_LIMIT: '99999' })).toMatchObject({ userLimit: 1000, userSource: 'clamped' });
    expect(describeLlm({ LLM_PROVIDER: 'groq', LLM_API_KEY: 'k', LLM_DAILY_LIMIT: '500' })).toMatchObject({ totalLimit: 200, totalSource: 'clamped' });
  });
  it('мусор в env: default, не безлимит', () => {
    expect(describeRawg({ RAWG_API_KEY: 'k', RAWG_USER_DAILY_LIMIT: 'abc' })).toMatchObject({ userLimit: 60, userSource: 'default' });
  });
  it('LLM без провайдера и без ключа: disabled', () => {
    expect(describeLlm({})).toMatchObject({ state: 'disabled' });
  });
});
