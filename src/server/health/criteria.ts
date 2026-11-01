// Критерии включения MULTIUSER_ENABLED=1 (docs/qa/phase-20-5.md, контракт F35.1). Чистая логика: данные и env приходят аргументами.
import { LLM_DEFAULT_USER_DAILY_LIMIT } from '@/server/env';
import type { LlmLimitView } from './limits';

type Env = Record<string, string | undefined>;

export type CriterionStatus = 'pass' | 'fail' | 'pending' | 'manual';
export type Criterion = { id: string; title: string; status: CriterionStatus; detail: string };

export type CriteriaInput = {
  env: Env;
  now: Date;
  multiuserEnabled: boolean;
  /** Строка владельца или null, если её нет. */
  owner: { role: string; status: string; psnAccessStatus: string; psnOnlineId: string | null } | null;
  /** Профили status in (invited, active): число и те, у кого есть ник PSN (их синкает обход) с временем последнего success. */
  activeProfiles: number;
  syncable: { id: number; lastSuccessAt: Date | null }[];
  llm: LlmLimitView;
};

export const SYNC_FRESH_MS = 36 * 60 * 60 * 1000;

export function evaluateCriteria(i: CriteriaInput): Criterion[] {
  const items: Criterion[] = [];

  const target = i.env.PSN_TARGET_ONLINE_ID?.trim().toLowerCase() ?? '';
  const miss: string[] = [];
  if (!i.owner) miss.push('владелец не найден');
  else {
    if (i.owner.role !== 'owner') miss.push('роль не owner');
    if (i.owner.status !== 'active') miss.push(`status=${i.owner.status}`);
    if (i.owner.psnAccessStatus !== 'ok') miss.push(`psn_access_status=${i.owner.psnAccessStatus}`);
    if (!target) miss.push('PSN_TARGET_ONLINE_ID не задан');
    else if (i.owner.psnOnlineId?.trim().toLowerCase() !== target) miss.push('ник владельца не равен PSN_TARGET_ONLINE_ID');
  }
  items.push({
    id: 'owner_ready',
    title: 'Владелец: active, psn_access_status=ok, ник = PSN_TARGET_ONLINE_ID',
    status: miss.length ? 'fail' : 'pass',
    detail: miss.length ? miss.join('; ') : 'Выполнено.',
  });

  const hasOrigin = !!i.env.SYNC_ORIGIN?.trim();
  items.push({
    id: 'env_sync_origin',
    title: 'SYNC_ORIGIN задан (боевой домен)',
    status: hasOrigin ? 'pass' : 'fail',
    detail: hasOrigin ? 'Задан.' : 'Не задан: цепочка синка и онбординг берут VERCEL_URL (при Deployment Protection ответ 401).',
  });
  const hasCron = !!i.env.CRON_SECRET?.trim();
  items.push({ id: 'env_cron_secret', title: 'CRON_SECRET задан', status: hasCron ? 'pass' : 'fail', detail: hasCron ? 'Задан.' : 'Не задан: cron-роуты не откроются.' });

  const need = i.activeProfiles * (i.llm.userLimit || LLM_DEFAULT_USER_DAILY_LIMIT);
  if (i.llm.state === 'disabled') {
    items.push({ id: 'env_llm_budget', title: 'LLM_DAILY_LIMIT не меньше профили x LLM_USER_DAILY_LIMIT', status: 'pass', detail: 'LLM выключен (работают шаблоны), бюджет не расходуется.' });
  } else {
    const okBudget = i.llm.totalLimit >= need;
    items.push({
      id: 'env_llm_budget',
      title: 'LLM_DAILY_LIMIT не меньше профили x LLM_USER_DAILY_LIMIT',
      status: okBudget ? 'pass' : 'fail',
      detail: `Нужно ${need} (${i.activeProfiles} x ${i.llm.userLimit}), задано ${i.llm.totalLimit}.`,
    });
  }

  items.push({ id: 'second_account_live', title: 'Живая проверка со вторым аккаунтом PSN', status: 'manual', detail: 'Приглашение, вход, онбординг, своя коллекция, у владельца игры без изменений. Из данных не вычислить.' });

  if (!i.multiuserEnabled) {
    items.push({ id: 'observation_sync', title: 'Ночной обход синкает всех профилей', status: 'pending', detail: 'MULTIUSER_ENABLED не включён: проверка появится после включения.' });
  } else {
    const stale = i.syncable.filter((u) => !u.lastSuccessAt || i.now.getTime() - u.lastSuccessAt.getTime() > SYNC_FRESH_MS).length;
    items.push({
      id: 'observation_sync',
      title: 'Ночной обход синкает всех профилей',
      status: i.syncable.length > 0 && stale === 0 ? 'pass' : 'fail',
      detail: i.syncable.length === 0 ? 'Нет профилей с ником PSN.' : stale === 0 ? 'У всех успешный синк за последние 36 часов.' : `Без успешного синка за 36 часов: ${stale} из ${i.syncable.length}.`,
    });
  }
  items.push({ id: 'observation_watchdog', title: 'Сутки наблюдения: watchdog без ложных алертов', status: 'manual', detail: 'Смотрит человек по Telegram и /api/health.' });
  items.push({ id: 'block_delete_member', title: 'Блокировка и удаление тестового участника', status: 'manual', detail: 'Проверить, что данные владельца не тронуты.' });
  items.push({ id: 'ci_green', title: 'Зелёные tsc, eslint, vitest, e2e', status: 'manual', detail: 'Проверяет CI/QA.' });
  return items;
}

export function summarizeCriteria(items: Criterion[]): Record<CriterionStatus, number> {
  const s: Record<CriterionStatus, number> = { pass: 0, fail: 0, pending: 0, manual: 0 };
  for (const c of items) s[c.status] += 1;
  return s;
}
