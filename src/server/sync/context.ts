// Состояние одного звена синка: счётчики, предупреждения, курсор, бюджет времени.
import { and, eq } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { asUserId, type UserId } from '@/server/auth/user-id';
import type { PsnClient } from '@/server/psn/types';

const { syncRuns } = schema;

export type RunRow = typeof syncRuns.$inferSelect;
export const PHASES = ['games', 'trophy_sets', 'trophy_link', 'trophies'] as const;
export type PhaseName = (typeof PHASES)[number];

export type Cursor = {
  phase: PhaseName;
  hops: number;
  /** момент последней записи состояния; по нему определяется «брошенный» запуск */
  heartbeat?: string;
  progress?: { done: number; total: number };
};

export type Counters = {
  gamesSeen: number;
  gamesUpserted: number;
  snapshotsWritten: number;
  trophySetsSynced: number;
  trophiesUpserted: number;
};

export type Warning = { code: string; message: string };
export const MAX_WARNINGS = 50;

export function parseCursor(raw: unknown): Cursor {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const phase = (PHASES as readonly unknown[]).includes(o.phase) ? (o.phase as PhaseName) : 'games';
  const p = o.progress as Record<string, unknown> | undefined;
  return {
    phase,
    hops: typeof o.hops === 'number' && o.hops >= 0 ? o.hops : 0,
    ...(typeof o.heartbeat === 'string' ? { heartbeat: o.heartbeat } : {}),
    ...(p && typeof p.done === 'number' && typeof p.total === 'number' ? { progress: { done: p.done, total: p.total } } : {}),
  };
}

export type PhaseResult = 'done' | 'timeout';

export class RunContext {
  readonly counters: Counters;
  readonly warnings: Warning[];
  cursor: Cursor;
  private readonly deadline: number;
  /** Владелец запуска (из sync_runs.user_id): все выборки и записи фаз ограничены им. */
  readonly userId: UserId;

  constructor(
    readonly db: AnyDb,
    readonly run: RunRow,
    readonly now: () => Date,
    budgetMs: number,
  ) {
    this.userId = asUserId(run.userId);
    this.counters = {
      gamesSeen: run.gamesSeen,
      gamesUpserted: run.gamesUpserted,
      snapshotsWritten: run.snapshotsWritten,
      trophySetsSynced: run.trophySetsSynced,
      trophiesUpserted: run.trophiesUpserted,
    };
    this.warnings = Array.isArray(run.warnings) ? ([...run.warnings] as Warning[]) : [];
    this.cursor = parseCursor(run.cursor);
    this.deadline = now().getTime() + budgetMs;
  }

  /** Единиц работы (транзакций) сделано в этом звене. Гарантирует прогресс при крошечном бюджете. */
  units = 0;

  /** Бюджет исчерпан и хотя бы одна единица работы уже сделана. */
  outOfTime(): boolean {
    return this.units > 0 && this.timeLeft() <= 0;
  }

  timeLeft(): number {
    return this.deadline - this.now().getTime();
  }

  warn(code: string, message: string): void {
    if (this.warnings.length < MAX_WARNINGS) this.warnings.push({ code, message: message.slice(0, 200) });
  }

  /** Запись состояния. Вызывается внутри транзакции батча, чтобы данные и курсор менялись атомарно. */
  async save(db: AnyDb = this.db, extra: Partial<typeof syncRuns.$inferInsert> = {}): Promise<void> {
    await db
      .update(syncRuns)
      .set({
        phase: this.cursor.phase,
        cursor: { ...this.cursor, heartbeat: this.now().toISOString() },
        ...this.counters,
        warnings: this.warnings,
        ...extra,
      })
      .where(and(eq(syncRuns.id, this.run.id), eq(syncRuns.userId, this.userId)));
  }
}

export type PhaseFn = (ctx: RunContext, psn: PsnClient) => Promise<PhaseResult>;
