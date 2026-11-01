// Сводка «Здоровье» для owner (контракт F35.1). К PSN не обращается. Запросы сгруппированы (без N+1).
import { and, desc, eq, gte, inArray, max, ne, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { getMultiuserEnv } from '@/server/env';
import { getTokenInfo, type PsnTokenInfo } from '@/server/psn/token-events';
import { mskDateString } from '@/server/stats/period';
import { evaluateCriteria, summarizeCriteria, type Criterion, type CriterionStatus } from './criteria';
import { describeHltb, describeLlm, describeRawg, usageCell, type LlmLimitView, type ProviderLimitView, type RawgLimitView, type UsageCell } from './limits';

const { allowedUsers, syncRuns, providerUsage, recommendLlmUsage } = schema;

type Env = Record<string, string | undefined>;

export const RECENT_ERRORS_PER_USER = 5;
export const RECENT_ERRORS_DAYS = 14;

export type HealthUser = {
  id: number;
  loginId: number;
  isPrimary: boolean;
  role: string;
  status: string;
  label: string | null;
  email: string | null;
  psnOnlineId: string | null;
  psnAccessStatus: string;
  psnAccessCheckedAt: string | null;
  onboardedAt: string | null;
  lastLoginAt: string | null;
  sync: {
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    recentErrors: { id: number; kind: string; status: string; errorReason: string | null; startedAt: string }[];
  };
  usage: { rawg: UsageCell; hltb: UsageCell; llm: UsageCell };
};

export type HealthOverview = {
  generatedAt: string;
  day: string;
  multiuser: { enabled: boolean; maxUsers: number; activeProfiles: number };
  limits: { rawg: RawgLimitView; hltb: ProviderLimitView; llm: LlmLimitView };
  psnToken: PsnTokenInfo | null;
  users: HealthUser[];
  totals: { rawg: UsageCell; hltb: UsageCell; llm: UsageCell };
  criteria: { summary: Record<CriterionStatus, number>; items: Criterion[] };
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function loadHealthOverview(db: AnyDb, env: Env, now: Date = new Date()): Promise<HealthOverview> {
  const day = mskDateString(now);
  const mu = getMultiuserEnv(env);
  const limits = { rawg: describeRawg(env), hltb: describeHltb(env), llm: describeLlm(env) };

  const users = await db.select().from(allowedUsers).where(ne(allowedUsers.status, 'archived')).orderBy(allowedUsers.id);
  const emailOfLogin = new Map(users.filter((u) => u.primaryUserId === null).map((u) => [u.id, u.email]));
  const ids = users.map((u) => u.id);

  const notHltb = and(inArray(syncRuns.userId, ids.length ? ids : [-1]), ne(syncRuns.kind, 'hltb'));
  const successRows = await db
    .select({ userId: syncRuns.userId, at: max(syncRuns.finishedAt) })
    .from(syncRuns)
    .where(and(notHltb, eq(syncRuns.status, 'success')))
    .groupBy(syncRuns.userId);
  const attemptRows = await db
    .select({ userId: syncRuns.userId, at: max(syncRuns.startedAt) })
    .from(syncRuns)
    .where(and(notHltb, sql`(${syncRuns.errorReason} is null or ${syncRuns.errorReason}::text <> 'cancelled')`))
    .groupBy(syncRuns.userId);
  const since = new Date(now.getTime() - RECENT_ERRORS_DAYS * 86_400_000);
  const errorRows = await db
    .select({ id: syncRuns.id, userId: syncRuns.userId, kind: syncRuns.kind, status: syncRuns.status, errorReason: syncRuns.errorReason, startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(and(notHltb, inArray(syncRuns.status, ['failed', 'partial']), gte(syncRuns.startedAt, since), sql`(${syncRuns.errorReason} is null or ${syncRuns.errorReason}::text <> 'cancelled')`))
    .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id))
    .limit(500);

  const success = new Map(successRows.map((r) => [r.userId as number, r.at]));
  const attempt = new Map(attemptRows.map((r) => [r.userId as number, r.at]));
  const errors = new Map<number, HealthUser['sync']['recentErrors']>();
  for (const r of errorRows) {
    const list = errors.get(r.userId as number) ?? [];
    if (list.length < RECENT_ERRORS_PER_USER) list.push({ id: r.id, kind: r.kind, status: r.status, errorReason: r.errorReason, startedAt: r.startedAt.toISOString() });
    errors.set(r.userId as number, list);
  }

  const providerRows = await db
    .select({ userId: providerUsage.userId, provider: providerUsage.provider, calls: providerUsage.calls })
    .from(providerUsage)
    .where(eq(providerUsage.day, day));
  const llmRows = await db.select({ userId: recommendLlmUsage.userId, calls: recommendLlmUsage.calls }).from(recommendLlmUsage).where(eq(recommendLlmUsage.day, day));
  const used = (provider: 'rawg' | 'hltb', uid: number) => providerRows.find((r) => r.userId === uid && r.provider === provider)?.calls ?? 0;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  let psnToken: PsnTokenInfo | null = null;
  try {
    psnToken = (await getTokenInfo(db, now))?.info ?? null;
  } catch {
    psnToken = null;
  }

  const rows: HealthUser[] = users.map((u) => {
    const isPrimary = u.primaryUserId === null;
    return {
      id: u.id,
      loginId: u.primaryUserId ?? u.id,
      isPrimary,
      role: u.role,
      status: u.status,
      label: u.displayName ?? u.psnOnlineId ?? null,
      email: isPrimary ? (emailOfLogin.get(u.id) ?? null) : null,
      psnOnlineId: u.psnOnlineId,
      psnAccessStatus: u.psnAccessStatus,
      psnAccessCheckedAt: iso(u.psnAccessCheckedAt),
      onboardedAt: iso(u.onboardedAt),
      lastLoginAt: isPrimary ? iso(u.lastLoginAt) : null,
      sync: { lastSuccessAt: iso(success.get(u.id)), lastAttemptAt: iso(attempt.get(u.id)), recentErrors: errors.get(u.id) ?? [] },
      usage: {
        rawg: usageCell(limits.rawg, used('rawg', u.id), 'user'),
        hltb: usageCell(limits.hltb, used('hltb', u.id), 'user'),
        llm: usageCell(limits.llm, llmRows.find((r) => r.userId === u.id)?.calls ?? 0, 'user'),
      },
    };
  });

  const live = users.filter((u) => u.status === 'invited' || u.status === 'active');
  const owner = users.find((u) => u.role === 'owner') ?? null;
  const items = evaluateCriteria({
    env,
    now,
    multiuserEnabled: mu.enabled,
    owner: owner ? { role: owner.role, status: owner.status, psnAccessStatus: owner.psnAccessStatus, psnOnlineId: owner.psnOnlineId } : null,
    activeProfiles: live.length,
    syncable: users.filter((u) => u.status === 'active' && u.psnOnlineId).map((u) => ({ id: u.id, lastSuccessAt: success.get(u.id) ?? null })),
    llm: limits.llm,
  });

  return {
    generatedAt: now.toISOString(),
    day,
    multiuser: { enabled: mu.enabled, maxUsers: mu.maxUsers, activeProfiles: live.length },
    limits,
    psnToken,
    users: rows,
    totals: {
      rawg: usageCell(limits.rawg, sum(providerRows.filter((r) => r.provider === 'rawg').map((r) => r.calls)), 'total'),
      hltb: usageCell(limits.hltb, sum(providerRows.filter((r) => r.provider === 'hltb').map((r) => r.calls)), 'total'),
      llm: usageCell(limits.llm, sum(llmRows.map((r) => r.calls)), 'total'),
    },
    criteria: { summary: summarizeCriteria(items), items },
  };
}
