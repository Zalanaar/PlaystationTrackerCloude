'use client';

// F20 (аудит UX): в режиме «Месяц» главный график — часы по дням месяца (годовой «Часы по месяцам» остаётся в режиме «Год»).
import { useEffect, useMemo, useState } from 'react';
import { fetchActivity } from '../collection/api';
import type { ActivityResponse } from '@/server/stats/activity';
import { monthName, plural } from '../format';
import { Panel } from './Panel';
import { ChartTable } from './ChartTable';
import { formatMinutes } from './activity';
import { dayValueText, daysModel } from './days';

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function DaysPanel({ year, month, wide }: { year: number; month: number; wide: boolean }) {
  const [state, setState] = useState<{ year: number; data?: ActivityResponse; failed?: boolean } | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetchActivity(year, ac.signal)
      .then((data) => { if (!ac.signal.aborted) setState({ year, data }); })
      .catch(() => { if (!ac.signal.aborted) setState({ year, failed: true }); });
    return () => ac.abort();
  }, [year]);
  const data = state?.year === year ? state.data : undefined;
  const failed = state?.year === year && state.failed;
  const m = useMemo(() => (data ? daysModel(data.days, year, month) : null), [data, year, month]);
  const gen = MONTHS_GEN[month - 1];
  const caption = `Часы по дням, ${monthName(month).toLowerCase()} ${year}`;
  return (
    <Panel
      title="Часы по дням" sub={`${monthName(month)} ${year}. По ежедневным снимкам`} labelId="st-hours"
      className={wide ? 'ps-st-panel--hours-wide' : 'ps-st-panel--hours'} busy={!m && !failed}
    >
      {failed ? (
        <p className="ps-st-days__sum" role="status">Не удалось загрузить часы по дням.</p>
      ) : !m ? (
        // скелет той же разметки: пустые столбцы, строка итога, «Таблицей» — без сдвига при ответе
        <div aria-hidden="true">
          <div className="ps-st-bars ps-st-bars--days" style={{ ['--n' as string]: 30 }}>
            {Array.from({ length: 30 }, (_, i) => <span key={i} className="ps-st-bar"><span className="ps-st-bar__col" /><span className="ps-st-bar__lbl">{i === 0 || (i + 1) % 5 === 0 ? i + 1 : ''}</span></span>)}
          </div>
          <p className="ps-st-days__sum"><span className="ps-skeleton ps-st-days__sksum" /></p>
          <ChartTable caption={caption} data={{ head: ['День', 'Часы'], rows: [['', '']] }} />
        </div>
      ) : (
        <>
          <div className="ps-st-bars ps-st-bars--days" style={{ ['--n' as string]: m.bars.length }} aria-hidden="true" data-testid="st-days">
            {m.bars.map((b) => (
              <span key={b.day} className="ps-st-bar" data-nodata={b.minutes === null || undefined} title={`${b.day} ${gen}: ${dayValueText(b.minutes)}`}>
                <span className="ps-st-bar__col">
                  {b.heightPct > 0 && <span className="ps-st-bar__stack" style={{ height: `${b.heightPct}%` }}><span className="ps-st-bar__fill" style={{ flexGrow: 1 }} /></span>}
                </span>
                <span className="ps-st-bar__lbl">{b.day === 1 || b.day % 5 === 0 ? b.day : ''}</span>
              </span>
            ))}
          </div>
          <p className="ps-st-days__sum num" data-testid="st-days-sum">
            {m.playedDays > 0
              ? <>Всего <b>{formatMinutes(m.totalMinutes)}</b> за {m.playedDays} {plural(m.playedDays, ['день', 'дня', 'дней'])}{m.best && <> · больше всего {m.best.day} {gen}: <b>{formatMinutes(m.best.minutes ?? 0)}</b></>}</>
              : m.hasData ? 'В этом месяце игровых дней нет' : 'За этот месяц снимков нет'}
          </p>
          <ChartTable caption={caption} data={{ head: ['День', 'Часы'], rows: m.bars.filter((b) => b.minutes !== null).map((b) => [`${b.day} ${gen}`, dayValueText(b.minutes)]) }} testId="tab-days" />
        </>
      )}
    </Panel>
  );
}
