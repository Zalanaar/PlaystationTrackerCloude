// W-3 (22.13): общий потолок LLM и предупреждение, если он меньше числа пользователей x потолок пользователя.
import { describe, expect, it } from 'vitest';
import { getLlmEnv, llmLimitWarning } from './env';

const base = { LLM_PROVIDER: 'groq', LLM_API_KEY: 'k' };

describe('LLM_DAILY_LIMIT', () => {
  it('по умолчанию 60 (5 пользователей x 12)', () => {
    expect(getLlmEnv(base)?.dailyLimit).toBe(60);
  });
  it('явное значение сохраняется, 0 выключает', () => {
    expect(getLlmEnv({ ...base, LLM_DAILY_LIMIT: '20' })?.dailyLimit).toBe(20);
    expect(getLlmEnv({ ...base, LLM_DAILY_LIMIT: '0' })).toBeNull();
  });
});

describe('llmLimitWarning', () => {
  it('предупреждает, если потолок меньше пользователей x 12; текст без ключа', () => {
    const llm = getLlmEnv({ ...base, LLM_DAILY_LIMIT: '20' });
    const w = llmLimitWarning(llm, 3);
    expect(w).toContain('LLM_DAILY_LIMIT=20');
    expect(w).toContain('36');
    expect(w).not.toContain('k"');
  });
  it('нет предупреждения: хватает, LLM выключен', () => {
    expect(llmLimitWarning(getLlmEnv({ ...base, LLM_DAILY_LIMIT: '24' }), 2)).toBeNull();
    expect(llmLimitWarning(getLlmEnv(base), 5)).toBeNull();
    expect(llmLimitWarning(null, 10)).toBeNull();
  });
  it('учитывает LLM_USER_DAILY_LIMIT', () => {
    const llm = getLlmEnv({ ...base, LLM_DAILY_LIMIT: '20', LLM_USER_DAILY_LIMIT: '5' });
    expect(llmLimitWarning(llm, 4)).toBeNull();
    expect(llmLimitWarning(llm, 5)).not.toBeNull();
  });
});
