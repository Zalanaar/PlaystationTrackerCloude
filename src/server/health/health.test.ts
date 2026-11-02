import { describe, expect, it } from 'vitest';
import { describeHltb, describeLlm, describeRawg, limitSource, usageCell } from './limits';
import { evaluateCriteria, summarizeCriteria, SYNC_FRESH_MS, type CriteriaInput } from './criteria';

describe('limitSource', () => {
  it('default / env / clamped', () => {
    expect(limitSource(undefined, 1, 10)).toBe('default');
    expect(limitSource('  ', 1, 10)).toBe('default');
    expect(limitSource('abc', 1, 10)).toBe('default');
    expect(limitSource('5', 1, 10)).toBe('env');
    expect(limitSource('0', 1, 10)).toBe('clamped');
    expect(limitSource('99', 1, 10)).toBe('clamped');
  });
});

describe('describeRawg', () => {
  it('без ключа выключен, а не безлимит', () => {
    const v = describeRawg({});
    expect(v).toMatchObject({ state: 'disabled', reason: 'no_key', keyConfigured: false, userLimit: 60, totalLimit: 300, userSource: 'default' });
    expect(usageCell(v, 4, 'user')).toEqual({ used: 4, limit: null });
  });
  it('ключ и потолки по умолчанию', () => {
    const v = describeRawg({ RAWG_API_KEY: 'k' });
    expect(v.state).toBe('active');
    expect(usageCell(v, 4, 'user')).toEqual({ used: 4, limit: 60 });
    expect(usageCell(v, 4, 'total')).toEqual({ used: 4, limit: 300 });
  });
  it('RAWG_DAILY_LIMIT=0 = выключено (limit_zero)', () => {
    expect(describeRawg({ RAWG_API_KEY: 'k', RAWG_DAILY_LIMIT: '0' })).toMatchObject({ state: 'disabled', reason: 'limit_zero', totalSource: 'env' });
  });
  it('RAWG_USER_DAILY_LIMIT=0 приводится к 1 и помечается clamped', () => {
    expect(describeRawg({ RAWG_API_KEY: 'k', RAWG_USER_DAILY_LIMIT: '0' })).toMatchObject({ state: 'active', userLimit: 1, userSource: 'clamped' });
  });
});

describe('describeHltb', () => {
  it('HLTB_DAILY_LIMIT=0 выключает', () => {
    expect(describeHltb({ HLTB_DAILY_LIMIT: '0' })).toMatchObject({ state: 'disabled', reason: 'limit_zero' });
    expect(describeHltb({})).toMatchObject({ state: 'active', userLimit: 300, totalLimit: 1000 });
  });
});

describe('describeLlm', () => {
  it('нет провайдера / нет ключа / лимит 0', () => {
    expect(describeLlm({})).toMatchObject({ state: 'disabled', reason: 'no_provider', provider: null });
    expect(describeLlm({ LLM_API_KEY: 'k', LLM_PROVIDER: 'bogus' })).toMatchObject({ state: 'disabled', reason: 'no_provider', provider: null });
    expect(describeLlm({ LLM_PROVIDER: 'groq' })).toMatchObject({ state: 'disabled', reason: 'no_key', provider: 'groq' });
    expect(describeLlm({ LLM_PROVIDER: 'groq', LLM_API_KEY: 'k', LLM_DAILY_LIMIT: '0' })).toMatchObject({ state: 'disabled', reason: 'limit_zero', totalLimit: 0 });
  });
  it('включён: умолчания 60/12', () => {
    const v = describeLlm({ LLM_PROVIDER: 'gemini', LLM_API_KEY: 'k' });
    expect(v).toMatchObject({ state: 'active', totalLimit: 60, userLimit: 12, provider: 'gemini' });
    expect(JSON.stringify(v)).not.toContain('"k"');
  });
});

const base = (o: Partial<CriteriaInput> = {}): CriteriaInput => ({
  env: { PSN_TARGET_ONLINE_ID: 'Target', SYNC_ORIGIN: 'https://x.app', CRON_SECRET: 'secret' },
  now: new Date('2026-11-01T10:00:00Z'),
  multiuserEnabled: false,
  owner: { role: 'owner', status: 'active', psnAccessStatus: 'ok', psnOnlineId: 'target' },
  activeProfiles: 2,
  syncable: [],
  llm: describeLlm({ LLM_PROVIDER: 'groq', LLM_API_KEY: 'k', LLM_DAILY_LIMIT: '60' }),
  ...o,
});
const byId = (i: CriteriaInput, id: string) => evaluateCriteria(i).find((c) => c.id === id)!;

describe('evaluateCriteria', () => {
  it('всё настроено: авто-пункты pass, ручные manual, наблюдение pending', () => {
    const items = evaluateCriteria(base());
    expect(items.map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'manual', 'pending', 'manual', 'manual', 'manual']);
    expect(summarizeCriteria(items)).toEqual({ pass: 4, fail: 0, pending: 1, manual: 4 });
  });
  it('владелец: перечень причин, регистр ника не важен', () => {
    expect(byId(base(), 'owner_ready').status).toBe('pass');
    const r = byId(base({ owner: { role: 'owner', status: 'active', psnAccessStatus: 'unchecked', psnOnlineId: 'Other' } }), 'owner_ready');
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('psn_access_status=unchecked');
    expect(r.detail).toContain('PSN_TARGET_ONLINE_ID');
    expect(byId(base({ owner: null }), 'owner_ready').status).toBe('fail');
  });
  it('env: нет SYNC_ORIGIN/CRON_SECRET = fail, значения не попадают в detail', () => {
    const i = base({ env: { PSN_TARGET_ONLINE_ID: 'Target', CRON_SECRET: 'topsecret' } });
    expect(byId(i, 'env_sync_origin').status).toBe('fail');
    expect(JSON.stringify(evaluateCriteria(i))).not.toContain('topsecret');
    expect(byId(base({ env: { PSN_TARGET_ONLINE_ID: 'Target' } }), 'env_cron_secret').status).toBe('fail');
  });
  it('бюджет LLM: профили x userLimit', () => {
    expect(byId(base({ activeProfiles: 5 }), 'env_llm_budget').status).toBe('pass'); // 60 >= 60
    const r = byId(base({ activeProfiles: 6 }), 'env_llm_budget');
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('72');
    expect(byId(base({ llm: describeLlm({}) }), 'env_llm_budget').detail).toContain('выключен');
  });
  it('наблюдение синка после включения', () => {
    const now = new Date('2026-11-01T10:00:00Z');
    const fresh = new Date(now.getTime() - SYNC_FRESH_MS + 1000);
    const old = new Date(now.getTime() - SYNC_FRESH_MS - 1000);
    expect(byId(base({ multiuserEnabled: true, syncable: [{ id: 1, lastSuccessAt: fresh }, { id: 2, lastSuccessAt: fresh }] }), 'observation_sync').status).toBe('pass');
    const r = byId(base({ multiuserEnabled: true, syncable: [{ id: 1, lastSuccessAt: fresh }, { id: 2, lastSuccessAt: old }, { id: 3, lastSuccessAt: null }] }), 'observation_sync');
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('2 из 3');
    expect(byId(base({ multiuserEnabled: true, syncable: [] }), 'observation_sync').status).toBe('fail');
  });
});
