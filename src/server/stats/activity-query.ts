// Выборка для стрика и тепловой карты (контракт 14.3): суточный агрегат дельт снимков одним запросом (строк = дней истории).
import { sql } from 'drizzle-orm';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { buildActivity, type ActivityDay, type ActivityResponse } from './activity';
import { mskDateString } from './period';

type Row = { date: string; seconds: number | string; deltas: number | string; first: string | null };

export async function getActivity(db: AnyDb, userId: UserId, year: number, now: Date = new Date()): Promise<ActivityResponse> {
  // Дельта к предыдущему снимку той же игры (lag по всем снимкам); видимость (9.10) применяется к сумме и счётчику дельт.
  // first = min(snapshot_date) по всей БД (как hours.firstSnapshotDate, скрытие не влияет).
  const res = await db.execute(sql`
    with d as (
      select p.snapshot_date,
             p.play_duration_seconds - lag(p.play_duration_seconds) over (partition by p.game_id order by p.snapshot_date) as delta,
             (g.hidden_at is null and pg.hidden_at is null) as visible
      from playtime_snapshots p
      join games g on g.id = p.game_id and g.user_id = p.user_id
      left join games pg on pg.id = g.duplicate_of_game_id and pg.user_id = g.user_id
      where p.user_id = ${userId}
    )
    select snapshot_date::text as date,
           coalesce(sum(greatest(delta, 0)) filter (where visible), 0)::int as seconds,
           (count(delta) filter (where visible))::int as deltas,
           (min(snapshot_date) over ())::text as first
    from d
    group by snapshot_date
    order by snapshot_date
  `);
  const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Row[];
  const days: ActivityDay[] = rows.map((r) => ({ date: r.date, seconds: Number(r.seconds), deltas: Number(r.deltas) }));
  return buildActivity({ rows: days, year, today: mskDateString(now), firstSnapshotDate: rows[0]?.first ?? null });
}
