'use client';

import type { RoadmapResponse } from '@/server/roadmap/types';
import { Icon, type IconName } from '../icons';
import { dayYearText, hoursLabel, hoursNum, pct, progressView } from './model';

const STATUS: Record<'on_track' | 'behind' | 'ahead', { icon: IconName; tone: string }> = {
  on_track: { icon: 'check', tone: 'success' },
  behind: { icon: 'arrow-down', tone: 'warning' },
  ahead: { icon: 'arrow-up', tone: 'success' },
};

/** Прогресс: часы по плану на сегодня против фактических часов игр плана (по снимкам синка). */
export function ProgressPanel({ data }: { data: RoadmapResponse }) {
  const v = progressView(data);
  let body;
  if (v.kind === 'empty') {
    body = <p className="ps-rm-status"><Icon name="info" size={20} /><span>Пока нечего сравнивать: в плане нет игр</span></p>;
  } else if (v.kind === 'not_started') {
    body = <p className="ps-rm-status"><Icon name="calendar" size={20} /><span>План начнётся 1 янв. {v.year}</span></p>;
  } else if (v.kind === 'past') {
    body = (
      <p className="ps-rm-status">
        <span>Итог {v.year}: сыграно <b className="num">{hoursLabel(v.actual)}</b> из <b className="num">{hoursLabel(v.planned)}</b> по плану</span>
      </p>
    );
  } else if (v.kind === 'no_data') {
    body = (
      <>
        <p className="ps-rm-status"><span className="ps-rm-ico" data-tone="muted"><Icon name="info" size={20} /></span><span>Нет данных о часах</span></p>
        <p className="ps-rm-note">История часов идёт с первого синка. До этого дня факт неизвестен.</p>
      </>
    );
  } else {
    const s = STATUS[v.kind];
    const text = v.kind === 'on_track' ? 'Иду по плану' : v.kind === 'behind' ? `Отстаю на ${hoursLabel(Math.abs(v.diff))}` : `Опережаю на ${hoursLabel(Math.abs(v.diff))}`;
    body = (
      <>
        <p className="ps-rm-status" data-state={v.kind}>
          <span className="ps-rm-ico" data-tone={s.tone}><Icon name={s.icon} size={20} /></span>
          <span>{text}</span>
        </p>
        <div className="ps-rm-metrics">
          <div><span className="ps-micro">План на сегодня</span><b className="num">{hoursLabel(v.planned)}</b></div>
          <div><span className="ps-micro">Сыграно</span><b className="num">{hoursLabel(v.actual)}</b></div>
        </div>
        <div className="ps-rm-meter">
          <div
            className="ps-rm-meter__bar" role="img"
            aria-label={`Сыграно ${hoursLabel(v.actual)}, по плану к сегодня ${hoursLabel(v.planned)}, всего на год ${hoursLabel(v.scale)}`}
          >
            <i style={{ width: `${pct(v.actual, v.scale)}%` }} />
            <u style={{ left: `${pct(v.planned, v.scale)}%` }} />
          </div>
          <small className="num">из {hoursNum(v.scale)} ч</small>
        </div>
        <p className="ps-rm-note">
          Часы игр из плана по ежедневным снимкам: {dayYearText(v.from)} – {dayYearText(v.asOf)}. Допуск «по плану»: {hoursLabel(v.tolerance)}.
        </p>
      </>
    );
  }
  return (
    <>
      <h2 className="ps-h2">Прогресс</h2>
      {body}
    </>
  );
}
