// Дельта снимка к предыдущему снимку той же игры — общая для «Активности», дневника дня и соседних дней.
// Первый снимок игры раньше дельты не давал вообще. Но игра, начатая уже после начала учёта (first_played_at не раньше
// первого дня снимков пользователя), до первого снимка имела 0 секунд: её первый снимок — это игра с нуля, она
// относится к дню этого снимка (как обычная дельта). Игры из самого первого синка и «старые» игры, всплывшие позже
// (first_played_at до начала учёта или неизвестен), по-прежнему дельты в первом снимке не дают.
import { sql, type SQL } from 'drizzle-orm';
import type { UserId } from '@/server/auth/user-id';

/** SQL-выражение дельты; в запросе должны быть алиасы p (playtime_snapshots) и g (games этой строки). */
export function snapshotDeltaSql(userId: UserId): SQL {
  return sql`coalesce(
    p.play_duration_seconds - lag(p.play_duration_seconds) over (partition by p.game_id order by p.snapshot_date),
    case when g.first_played_at is not null
           and p.snapshot_date > (select min(f.snapshot_date) from playtime_snapshots f where f.user_id = ${userId})
           and g.first_played_at >= ((select min(f.snapshot_date) from playtime_snapshots f where f.user_id = ${userId})::timestamp at time zone 'Europe/Moscow')
           and p.snapshot_date = min(p.snapshot_date) over (partition by p.game_id)
         then p.play_duration_seconds end
  )`;
}
